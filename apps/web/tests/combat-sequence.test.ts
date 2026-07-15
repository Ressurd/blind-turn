import { afterEach, describe, expect, it, vi } from "vitest";
import { HP_SCALE, type PublicBattleEvent } from "@blind-turn/shared";
import {
  applyCombatDamage,
  applyDeckPlaybackStage,
  buildCombatSequences,
  createCombatDisplayState,
  createCombatDeckDisplayState,
  hydrateCombatDamageTransitions,
  synchronizeCombatDisplayState,
} from "../src/features/multiplayer/combat-sequence";
import {
  COMBAT_PLAYBACK_BEATS,
  PLAYBACK_BEAT_MS,
  createPlaybackTimer,
  getPlaybackDuration,
  getCombatPlaybackSteps,
  playbackPhaseForStage,
  scalePlaybackDuration,
} from "../src/features/multiplayer/use-combat-playback";

const hp = (value: number) => value * HP_SCALE;
const step = (body: PublicBattleEvent[], stepIndex = 0): PublicBattleEvent[] => [
  { type: "STEP_STARTED", roundNumber: 1, stepIndex },
  ...body,
  { type: "STEP_FINISHED", roundNumber: 1, stepIndex },
];

describe("buildCombatSequences V2", () => {
  it("groups reveal, normal attack, damage, and death in one step sequence", () => {
    const events = step([
      { type: "CARD_REVEALED", roundNumber: 1, stepIndex: 0, playerId: "a", cardInstanceId: "a1", cardId: "BASE_QUICK_STRIKE", targetPlayerId: "b" },
      { type: "ATTACK_STARTED", stepIndex: 0, attackerId: "a", targetId: "b", cardId: "BASE_QUICK_STRIKE", damage: hp(3) },
      { type: "DAMAGE_APPLIED", stepIndex: 0, playerId: "b", damage: hp(3), remainingHp: 0, source: "ATTACK" },
      { type: "PLAYER_DIED", stepIndex: 0, playerId: "b" },
    ]);
    const [sequence] = buildCombatSequences(events);
    expect(sequence).toMatchObject({
      type: "STEP",
      actorId: "a",
      targetIds: ["b"],
      outcome: "ATTACK",
      deathPlayerIds: ["b"],
      originalEventRange: { start: 0, end: 5 },
    });
    expect(sequence?.cards[0]?.cardName).toBe("속공");
  });

  it("marks Guard reduction, successful Evade, and failed Evade distinctly", () => {
    const guarded = buildCombatSequences(step([
      { type: "CARD_REVEALED", roundNumber: 1, stepIndex: 0, playerId: "b", cardInstanceId: "g", cardId: "BASE_GUARD" },
      { type: "GUARD_ACTIVATED", stepIndex: 0, playerId: "b", reduction: hp(5), mode: "TOTAL" },
      { type: "GUARD_RESOLVED", stepIndex: 0, playerId: "b", incomingDamage: hp(5), reducedDamage: hp(5), finalDamage: 0 },
    ]))[0];
    expect(guarded?.outcome).toBe("GUARD");

    const success = buildCombatSequences(step([
      { type: "EVADE_ROLLED", stepIndex: 0, playerId: "b", attackerId: "a", roll: 8, bonus: 0, difficulty: 8, succeeded: true },
    ]))[0];
    expect(success?.outcome).toBe("EVADE_SUCCESS");
    expect(success?.damages).toEqual([]);

    const failed = buildCombatSequences(step([
      { type: "EVADE_ROLLED", stepIndex: 0, playerId: "b", attackerId: "a", roll: 7, bonus: 0, difficulty: 8, succeeded: false },
      { type: "EVADE_FAILED", stepIndex: 0, playerId: "b" },
      { type: "DAMAGE_APPLIED", stepIndex: 0, playerId: "b", damage: hp(10), remainingHp: hp(20), source: "EVADE_FAILURE" },
    ]))[0];
    expect(failed?.outcome).toBe("EVADE_FAILURE");
    expect(failed?.damages[0]?.damage).toBe(hp(10));
  });

  it("keeps counter simultaneous damage in one sequence", () => {
    const [sequence] = buildCombatSequences(step([
      { type: "COUNTER_TRIGGERED", stepIndex: 0, counterPlayerId: "b", attackerId: "a", attackerDamage: hp(10), counterDamage: hp(2.5) },
      { type: "DAMAGE_APPLIED", stepIndex: 0, playerId: "a", damage: hp(10), remainingHp: hp(20), source: "COUNTER" },
      { type: "DAMAGE_APPLIED", stepIndex: 0, playerId: "b", damage: hp(2.5), remainingHp: hp(27.5), source: "COUNTER" },
    ]));
    expect(sequence).toMatchObject({
      outcome: "COUNTER",
      actorId: "b",
      counterActorId: "b",
      targetIds: ["a"],
    });
    expect(sequence?.damages).toHaveLength(2);
  });

  it("keeps clash dice totals and winner in one sequence", () => {
    const [sequence] = buildCombatSequences(step([
      { type: "CLASH_STARTED", stepIndex: 0, playerIds: ["a", "b"], cardIds: ["BASE_QUICK_STRIKE", "BASE_HEAVY_STRIKE"] },
      { type: "CLASH_ROLLED", stepIndex: 0, playerId: "a", roll: 5, bonus: 3, total: 8 },
      { type: "CLASH_ROLLED", stepIndex: 0, playerId: "b", roll: 6, bonus: 0, total: 6 },
      { type: "CLASH_RESOLVED", stepIndex: 0, winnerId: "a", loserId: "b" },
    ]));
    expect(sequence).toMatchObject({ outcome: "CLASH", winnerId: "a", loserId: "b" });
    expect(sequence?.rolls.map((roll) => roll.total)).toEqual([8, 6]);
    expect(sequence?.clash).toMatchObject({
      participants: [
        { playerId: "a", cardId: "BASE_QUICK_STRIKE", cardName: "속공" },
        { playerId: "b", cardId: "BASE_HEAVY_STRIKE", cardName: "강공" },
      ],
      attempts: [{ attemptNumber: 1, tied: false }],
    });
    expect(sequence?.clash?.attempts[0]?.rolls[0]).toMatchObject({
      roll: 5,
      cardBonus: 2,
      characterBonus: 1,
      total: 8,
    });
  });
});

describe("combat display state", () => {
  it("updates display HP in event order instead of jumping to server state", () => {
    const sequences = buildCombatSequences([
      ...step([{ type: "DAMAGE_APPLIED", stepIndex: 0, playerId: "b", damage: hp(3), remainingHp: hp(27), source: "ATTACK" }], 0),
      ...step([{ type: "DAMAGE_APPLIED", stepIndex: 1, playerId: "b", damage: hp(5), remainingHp: hp(22), source: "ATTACK" }], 1),
    ]);
    const initial = createCombatDisplayState([{ playerId: "b", hp: hp(30), maxHp: hp(30), alive: true }]);
    const hydrated = hydrateCombatDamageTransitions(sequences, initial);
    const first = applyCombatDamage(initial, hydrated[0]!);
    const second = applyCombatDamage(first, hydrated[1]!);
    expect(first.b?.hp).toBe(hp(27));
    expect(second.b?.hp).toBe(hp(22));
    expect(hydrated[1]?.damages[0]?.previousHp).toBe(hp(27));
  });

  it("clones and synchronizes to final server state after skip", () => {
    const serverState = createCombatDisplayState([
      { playerId: "a", hp: hp(30), alive: true },
      { playerId: "b", hp: 0, alive: false },
    ]);
    const synchronized = synchronizeCombatDisplayState(serverState);
    expect(synchronized).toEqual(serverState);
    expect(synchronized).not.toBe(serverState);
    expect(synchronized.b).not.toBe(serverState.b);
  });

  it("updates deck display state in reshuffle then draw order", () => {
    const sequence = buildCombatSequences([
      { type: "DISCARD_RESHUFFLE_STARTED", playerId: "a", discardCount: 6 },
      { type: "DISCARD_RESHUFFLED", playerId: "a", drawPileCount: 6 },
      { type: "CARD_DRAWN", playerId: "a", count: 1, drawPileCount: 5, handCount: 4 },
    ])[0]!;
    const initial = createCombatDeckDisplayState([
      { playerId: "a", handCount: 3, drawPileCount: 0, discardPileCount: 6, totalDeckCount: 9 },
    ]);
    const started = applyDeckPlaybackStage(initial, sequence, "reshuffle-start");
    const shuffled = applyDeckPlaybackStage(started, sequence, "reshuffle-complete");
    const drawn = applyDeckPlaybackStage(shuffled, sequence, "draw");
    expect(started.a).toMatchObject({ handCount: 3, drawPileCount: 0, discardPileCount: 6 });
    expect(shuffled.a).toMatchObject({ handCount: 3, drawPileCount: 6, discardPileCount: 0 });
    expect(drawn.a).toMatchObject({ handCount: 4, drawPileCount: 5, discardPileCount: 0 });
  });
});

describe("playback timer lifecycle", () => {
  afterEach(() => vi.useRealTimers());

  it("clears its timer on component cleanup", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const timer = createPlaybackTimer();
    timer.schedule(callback, 500);
    timer.dispose();
    vi.advanceTimersByTime(1_000);
    expect(timer.hasPending()).toBe(false);
    expect(callback).not.toHaveBeenCalled();
  });

  it("uses non-overlapping 600ms beat phases and global speed ratios", () => {
    const [sequence] = buildCombatSequences(step([
      { type: "CARD_REVEALED", roundNumber: 1, stepIndex: 0, playerId: "a", cardInstanceId: "a1", cardId: "BASE_QUICK_STRIKE", targetPlayerId: "b" },
      { type: "EVADE_ROLLED", stepIndex: 0, playerId: "b", attackerId: "a", roll: 7, bonus: 0, difficulty: 8, succeeded: false },
      { type: "DAMAGE_APPLIED", stepIndex: 0, playerId: "b", damage: hp(10), remainingHp: hp(20), source: "EVADE_FAILURE" },
    ]));
    const steps = getCombatPlaybackSteps(sequence!);
    expect(steps.map((entry) => entry.stage)).toEqual(["step-intro", "reveal", "focus", "roll", "damage", "summary", "transition"]);
    expect(steps.every((entry) => entry.durationMs % PLAYBACK_BEAT_MS === 0)).toBe(true);
    expect(steps.map((entry) => playbackPhaseForStage(entry.stage))).toEqual([
      "STEP_INTRO",
      "REVEALING_CARDS",
      "FOCUSING_INTERACTION",
      "PLAYING_INTERACTION",
      "APPLYING_STEP_DAMAGE",
      "SHOWING_STEP_SUMMARY",
      "STEP_TRANSITION",
    ]);
    expect(scalePlaybackDuration(1_800, 1)).toBe(1_800);
    expect(scalePlaybackDuration(1_800, 1.5)).toBe(1_200);
    expect(scalePlaybackDuration(1_800, 2)).toBe(900);
    expect(getPlaybackDuration(2, 1)).toBe(1_200);
    expect(getPlaybackDuration(2, 1.5)).toBe(800);
    expect(getPlaybackDuration(2, 2)).toBe(600);
  });

  it("plays each server clash roll in order, repeats ties, then reveals the winner", () => {
    const [sequence] = buildCombatSequences(step([
      { type: "CARD_REVEALED", roundNumber: 1, stepIndex: 0, playerId: "a", cardInstanceId: "a1", cardId: "BASE_QUICK_STRIKE", targetPlayerId: "b" },
      { type: "CARD_REVEALED", roundNumber: 1, stepIndex: 0, playerId: "b", cardInstanceId: "b1", cardId: "BASE_HEAVY_STRIKE", targetPlayerId: "a" },
      { type: "CLASH_STARTED", stepIndex: 0, playerIds: ["a", "b"], cardIds: ["BASE_QUICK_STRIKE", "BASE_HEAVY_STRIKE"] },
      { type: "CLASH_ROLLED", stepIndex: 0, playerId: "a", roll: 6, bonus: 2, total: 8 },
      { type: "CLASH_ROLLED", stepIndex: 0, playerId: "b", roll: 8, bonus: 0, total: 8 },
      { type: "CLASH_ROLLED", stepIndex: 0, playerId: "a", roll: 7, bonus: 2, total: 9 },
      { type: "CLASH_ROLLED", stepIndex: 0, playerId: "b", roll: 6, bonus: 0, total: 6 },
      { type: "CLASH_RESOLVED", stepIndex: 0, winnerId: "a", loserId: "b" },
      { type: "DAMAGE_APPLIED", stepIndex: 0, playerId: "b", damage: hp(3), remainingHp: hp(27), source: "ATTACK" },
    ]));
    expect(sequence?.clash?.attempts.map((attempt) => ({
      attemptNumber: attempt.attemptNumber,
      totals: attempt.rolls.map((roll) => roll.total),
      tied: attempt.tied,
    }))).toEqual([
      { attemptNumber: 1, totals: [8, 8], tied: true },
      { attemptNumber: 2, totals: [9, 6], tied: false },
    ]);

    const stages = getCombatPlaybackSteps(sequence!).map((entry) => entry.stage);
    expect(stages).toEqual([
      "step-intro", "reveal", "clash-intro",
      "clash-first-roll", "clash-first-result", "clash-second-roll", "clash-second-result",
      "clash-modifiers", "clash-compare", "clash-tie",
      "clash-first-roll", "clash-first-result", "clash-second-roll", "clash-second-result",
      "clash-modifiers", "clash-compare", "clash-winner",
      "impact", "damage", "summary", "transition",
    ]);
    expect(stages.indexOf("clash-first-result")).toBeLessThan(stages.indexOf("clash-second-roll"));
    expect(stages.lastIndexOf("clash-compare")).toBeLessThan(stages.indexOf("clash-winner"));
    expect(getCombatPlaybackSteps(sequence!).every((entry) => entry.durationMs % PLAYBACK_BEAT_MS === 0)).toBe(true);

    const reducedStages = getCombatPlaybackSteps(sequence!, true).map((entry) => entry.stage);
    expect(reducedStages).not.toContain("clash-first-roll");
    expect(reducedStages).not.toContain("clash-second-roll");
    expect(reducedStages.indexOf("clash-first-result")).toBeLessThan(reducedStages.indexOf("clash-second-result"));
    expect(reducedStages).toContain("clash-tie");
    expect(reducedStages).toContain("clash-winner");
  });

  it("reveals all cards in one beat regardless of player count", () => {
    const oneCard = buildCombatSequences(step([
      { type: "CARD_REVEALED", roundNumber: 1, stepIndex: 0, playerId: "a", cardInstanceId: "a1", cardId: "BASE_GUARD" },
    ]))[0]!;
    const sixCards = buildCombatSequences(step(Array.from({ length: 6 }, (_, index) => ({
      type: "CARD_REVEALED" as const,
      roundNumber: 1,
      stepIndex: 0,
      playerId: `p${index}`,
      cardInstanceId: `c${index}`,
      cardId: "BASE_GUARD",
    }))))[0]!;
    const revealDuration = (sequence: typeof oneCard) => getCombatPlaybackSteps(sequence).find((entry) => entry.stage === "reveal")?.durationMs;
    expect(revealDuration(oneCard)).toBe(PLAYBACK_BEAT_MS * COMBAT_PLAYBACK_BEATS.cardReveal);
    expect(revealDuration(sixCards)).toBe(revealDuration(oneCard));
  });

  it("applies every player's step damage in one shared damage beat", () => {
    const sequence = buildCombatSequences(step([
      { type: "DAMAGE_APPLIED", stepIndex: 0, playerId: "a", damage: hp(3), remainingHp: hp(27), source: "ATTACK" },
      { type: "DAMAGE_APPLIED", stepIndex: 0, playerId: "b", damage: hp(10), remainingHp: hp(20), source: "COUNTER" },
    ]))[0]!;
    expect(getCombatPlaybackSteps(sequence).filter((entry) => entry.stage === "damage")).toEqual([
      { stage: "damage", durationMs: PLAYBACK_BEAT_MS },
    ]);
    const applied = applyCombatDamage(createCombatDisplayState([
      { playerId: "a", hp: hp(30), alive: true },
      { playerId: "b", hp: hp(30), alive: true },
    ]), sequence);
    expect(applied.a?.hp).toBe(hp(27));
    expect(applied.b?.hp).toBe(hp(20));
  });

  it("places reshuffle stages before draw and includes a round-end summary", () => {
    const sequences = buildCombatSequences([
      { type: "ROUND_STARTED", roundNumber: 4 },
      { type: "DISCARD_RESHUFFLE_STARTED", playerId: "a", discardCount: 6 },
      { type: "DISCARD_RESHUFFLED", playerId: "a", drawPileCount: 6 },
      { type: "CARD_DRAWN", playerId: "a", count: 1, drawPileCount: 5, handCount: 4 },
      { type: "ROUND_FINISHED", roundNumber: 4 },
    ]);
    expect(sequences.map((sequence) => sequence.type)).toEqual(["ROUND", "DECK", "ROUND_SUMMARY"]);
    expect(getCombatPlaybackSteps(sequences[1]!).map((entry) => entry.stage)).toEqual([
      "step-intro",
      "reshuffle-start",
      "reshuffle-shuffle",
      "reshuffle-complete",
      "draw",
      "result",
    ]);
    expect(getCombatPlaybackSteps(sequences[2]!)).toEqual([
      { stage: "summary", durationMs: PLAYBACK_BEAT_MS * COMBAT_PLAYBACK_BEATS.stepSummary },
    ]);
  });

  it("keeps consecutive step sequences in distinct event ranges", () => {
    const sequences = buildCombatSequences([
      ...step([{ type: "CARD_REVEALED", roundNumber: 1, stepIndex: 0, playerId: "a", cardInstanceId: "a1", cardId: "BASE_GUARD" }], 0),
      ...step([{ type: "CARD_REVEALED", roundNumber: 1, stepIndex: 1, playerId: "b", cardInstanceId: "b1", cardId: "BASE_EVADE" }], 1),
    ]);
    expect(sequences).toHaveLength(2);
    expect(sequences[0]!.originalEventRange.end).toBeLessThan(sequences[1]!.originalEventRange.start);
  });
});
