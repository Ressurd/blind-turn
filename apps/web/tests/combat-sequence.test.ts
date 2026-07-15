import { afterEach, describe, expect, it, vi } from "vitest";
import { HP_SCALE, type PublicBattleEvent } from "@blind-turn/shared";
import {
  applyCombatDamage,
  applyDeckPlaybackStage,
  buildCombatSequences,
  createCombatDeckDisplayState,
  createCombatDisplayState,
  hydrateCombatDamageTransitions,
  synchronizeCombatDisplayState,
} from "../src/features/multiplayer/combat-sequence";
import {
  CLASH_ROULETTE_TICK_MS,
  CLASH_ROULETTE_TOTAL_MS,
  COMBAT_PLAYBACK_BEATS,
  PLAYBACK_BEAT_MS,
  createPlaybackTimer,
  getCombatPlaybackSteps,
  getPlaybackDuration,
  playbackPhaseForStage,
  scalePlaybackDuration,
} from "../src/features/multiplayer/use-combat-playback";
import { createClashRouletteFrames } from "../src/features/multiplayer/CombatStage";

const hp = (value: number) => value * HP_SCALE;
const turn = (body: PublicBattleEvent[], roundNumber = 1): PublicBattleEvent[] => [
  { type: "TURN_RESOLUTION_STARTED", roundNumber },
  ...body,
  { type: "TURN_RESOLUTION_FINISHED", roundNumber },
];

describe("buildCombatSequences single-turn grouping", () => {
  it("groups reveal, attack, damage, and death in one turn sequence", () => {
    const [sequence] = buildCombatSequences(turn([
      { type: "CARD_REVEALED", roundNumber: 1, playerId: "a", cardInstanceId: "a1", cardId: "BASE_QUICK_STRIKE", targetPlayerId: "b" },
      { type: "ATTACK_STARTED", attackerId: "a", targetId: "b", cardId: "BASE_QUICK_STRIKE", damage: hp(3) },
      { type: "DAMAGE_APPLIED", playerId: "b", damage: hp(3), remainingHp: 0, source: "ATTACK" },
      { type: "PLAYER_DIED", playerId: "b" },
    ]));
    expect(sequence).toMatchObject({
      type: "TURN",
      actorId: "a",
      targetIds: ["b"],
      outcome: "ATTACK",
      deathPlayerIds: ["b"],
    });
    expect(sequence?.originalEventRange).toEqual({ start: 0, end: 5 });
  });

  it("distinguishes guard, evade success, and evade failure", () => {
    const guard = buildCombatSequences(turn([
      { type: "CARD_REVEALED", roundNumber: 1, playerId: "b", cardInstanceId: "g", cardId: "BASE_GUARD" },
      { type: "GUARD_ACTIVATED", playerId: "b", reduction: hp(5), mode: "TOTAL" },
      { type: "GUARD_RESOLVED", playerId: "b", incomingDamage: hp(5), reducedDamage: hp(5), finalDamage: 0 },
    ]))[0]!;
    expect(guard.outcome).toBe("GUARD");

    const success = buildCombatSequences(turn([
      { type: "EVADE_ROLLED", playerId: "b", attackerId: "a", roll: 8, bonus: 0, difficulty: 8, succeeded: true },
    ]))[0]!;
    expect(success.outcome).toBe("EVADE_SUCCESS");

    const failure = buildCombatSequences(turn([
      { type: "EVADE_ROLLED", playerId: "b", attackerId: "a", roll: 7, bonus: 0, difficulty: 8, succeeded: false },
      { type: "EVADE_FAILED", playerId: "b" },
      { type: "DAMAGE_APPLIED", playerId: "b", damage: hp(10), remainingHp: hp(20), source: "EVADE_FAILURE" },
    ]))[0]!;
    expect(failure.outcome).toBe("EVADE_FAILURE");
  });

  it("keeps simultaneous counter damage in one sequence", () => {
    const [sequence] = buildCombatSequences(turn([
      { type: "COUNTER_TRIGGERED", counterPlayerId: "b", attackerId: "a", attackerDamage: hp(10), counterDamage: hp(2.5) },
      { type: "DAMAGE_APPLIED", playerId: "a", damage: hp(10), remainingHp: hp(20), source: "COUNTER" },
      { type: "DAMAGE_APPLIED", playerId: "b", damage: hp(2.5), remainingHp: hp(27.5), source: "COUNTER" },
    ]));
    expect(sequence?.outcome).toBe("COUNTER");
    expect(sequence?.damages).toHaveLength(2);
  });

  it("keeps clash attempts and winner without a next-action penalty", () => {
    const [sequence] = buildCombatSequences(turn([
      { type: "CARD_REVEALED", roundNumber: 1, playerId: "a", cardInstanceId: "a1", cardId: "BASE_QUICK_STRIKE", targetPlayerId: "b" },
      { type: "CARD_REVEALED", roundNumber: 1, playerId: "b", cardInstanceId: "b1", cardId: "BASE_HEAVY_STRIKE", targetPlayerId: "a" },
      { type: "CLASH_STARTED", playerIds: ["a", "b"], cardIds: ["BASE_QUICK_STRIKE", "BASE_HEAVY_STRIKE"] },
      { type: "CLASH_ROLLED", playerId: "a", roll: 6, bonus: 2, total: 8 },
      { type: "CLASH_ROLLED", playerId: "b", roll: 8, bonus: 0, total: 8 },
      { type: "CLASH_ROLLED", playerId: "a", roll: 7, bonus: 2, total: 9 },
      { type: "CLASH_ROLLED", playerId: "b", roll: 6, bonus: 0, total: 6 },
      { type: "CLASH_RESOLVED", winnerId: "a", loserId: "b" },
      { type: "DAMAGE_APPLIED", playerId: "b", damage: hp(3), remainingHp: hp(27), source: "ATTACK" },
    ]));
    expect(sequence?.outcome).toBe("CLASH");
    expect(sequence?.winnerId).toBe("a");
    expect(sequence?.clash?.attempts.map((attempt) => attempt.tied)).toEqual([
      true,
      false,
    ]);
    expect(sequence?.clash).not.toHaveProperty("penalty");
  });

  it("hydrates display HP in event order and can sync to final server state", () => {
    const sequences = buildCombatSequences([
      ...turn([{ type: "DAMAGE_APPLIED", playerId: "b", damage: hp(3), remainingHp: hp(27), source: "ATTACK" }], 1),
      ...turn([{ type: "DAMAGE_APPLIED", playerId: "b", damage: hp(5), remainingHp: hp(22), source: "ATTACK" }], 2),
    ]);
    const initial = createCombatDisplayState([
      { playerId: "b", hp: hp(30), alive: true },
    ]);
    const hydrated = hydrateCombatDamageTransitions(sequences, initial);
    expect(hydrated[0]?.damages[0]?.previousHp).toBe(hp(30));
    expect(hydrated[1]?.damages[0]?.previousHp).toBe(hp(27));
    const first = applyCombatDamage(initial, hydrated[0]!);
    const second = applyCombatDamage(first, hydrated[1]!);
    expect(second.b?.hp).toBe(hp(22));

    const serverState = createCombatDisplayState([
      { playerId: "b", hp: 0, alive: false },
    ]);
    const synchronized = synchronizeCombatDisplayState(serverState);
    expect(synchronized).toEqual(serverState);
    expect(synchronized.b).not.toBe(serverState.b);
  });

  it("updates deck display in reshuffle then draw order", () => {
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
    expect(shuffled.a).toMatchObject({ drawPileCount: 6, discardPileCount: 0 });
    expect(drawn.a).toMatchObject({ handCount: 4, drawPileCount: 5 });
  });
});

describe("playback controller", () => {
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

  it("uses turn phases and global speed ratios", () => {
    const sequence = buildCombatSequences(turn([
      { type: "CARD_REVEALED", roundNumber: 1, playerId: "a", cardInstanceId: "a1", cardId: "BASE_QUICK_STRIKE", targetPlayerId: "b" },
      { type: "EVADE_ROLLED", playerId: "b", attackerId: "a", roll: 7, bonus: 0, difficulty: 8, succeeded: false },
      { type: "DAMAGE_APPLIED", playerId: "b", damage: hp(10), remainingHp: hp(20), source: "EVADE_FAILURE" },
    ]))[0]!;
    const stages = getCombatPlaybackSteps(sequence).map((entry) => entry.stage);
    expect(stages).toEqual([
      "turn-intro",
      "reveal",
      "focus",
      "roll",
      "damage",
      "summary",
      "transition",
    ]);
    expect(stages.map(playbackPhaseForStage)).toEqual([
      "TURN_INTRO",
      "REVEALING_CARDS",
      "FOCUSING_INTERACTION",
      "PLAYING_INTERACTION",
      "APPLYING_TURN_DAMAGE",
      "SHOWING_TURN_SUMMARY",
      "TURN_TRANSITION",
    ]);
    expect(scalePlaybackDuration(1_800, 1.5)).toBe(1_200);
    expect(getPlaybackDuration(2, 2)).toBe(750);
  });

  it("plays each server clash roll, repeats ties, then reveals the winner", () => {
    const sequence = buildCombatSequences(turn([
      { type: "CARD_REVEALED", roundNumber: 1, playerId: "a", cardInstanceId: "a1", cardId: "BASE_QUICK_STRIKE", targetPlayerId: "b" },
      { type: "CARD_REVEALED", roundNumber: 1, playerId: "b", cardInstanceId: "b1", cardId: "BASE_HEAVY_STRIKE", targetPlayerId: "a" },
      { type: "CLASH_STARTED", playerIds: ["a", "b"], cardIds: ["BASE_QUICK_STRIKE", "BASE_HEAVY_STRIKE"] },
      { type: "CLASH_ROLLED", playerId: "a", roll: 6, bonus: 2, total: 8 },
      { type: "CLASH_ROLLED", playerId: "b", roll: 8, bonus: 0, total: 8 },
      { type: "CLASH_ROLLED", playerId: "a", roll: 7, bonus: 2, total: 9 },
      { type: "CLASH_ROLLED", playerId: "b", roll: 6, bonus: 0, total: 6 },
      { type: "CLASH_RESOLVED", winnerId: "a", loserId: "b" },
      { type: "DAMAGE_APPLIED", playerId: "b", damage: hp(3), remainingHp: hp(27), source: "ATTACK" },
    ]))[0]!;
    const stages = getCombatPlaybackSteps(sequence).map((entry) => entry.stage);
    expect(stages.filter((stage) => stage === "clash-first-roll")).toHaveLength(2);
    expect(stages).toContain("clash-tie");
    expect(stages).toContain("clash-winner");
    expect(getCombatPlaybackSteps(sequence).filter((entry) =>
      entry.stage === "clash-first-roll" || entry.stage === "clash-second-roll"
    ).every((entry) => entry.durationMs === CLASH_ROULETTE_TOTAL_MS)).toBe(true);
    const frames = createClashRouletteFrames(7, 1);
    expect(frames).toHaveLength(
      Math.ceil(CLASH_ROULETTE_TOTAL_MS / CLASH_ROULETTE_TICK_MS) + 1,
    );
    expect(frames.at(-1)).toBe(7);
    const reduced = getCombatPlaybackSteps(sequence, true).map((entry) => entry.stage);
    expect(reduced).not.toContain("clash-first-roll");
    expect(reduced).toContain("clash-winner");
  });

  it("reveals 2- and 6-player cards in one shared beat", () => {
    const build = (count: number) => buildCombatSequences(turn(
      Array.from({ length: count }, (_, index) => ({
        type: "CARD_REVEALED" as const,
        roundNumber: 1,
        playerId: `p${index}`,
        cardInstanceId: `c${index}`,
        cardId: "BASE_GUARD",
      })),
    ))[0]!;
    const revealDuration = (count: number) => getCombatPlaybackSteps(build(count))
      .find((entry) => entry.stage === "reveal")?.durationMs;
    expect(revealDuration(2)).toBe(
      PLAYBACK_BEAT_MS * COMBAT_PLAYBACK_BEATS.cardReveal,
    );
    expect(revealDuration(6)).toBe(revealDuration(2));
  });

  it("places reshuffle stages before draw and includes a turn summary", () => {
    const sequences = buildCombatSequences([
      { type: "ROUND_STARTED", roundNumber: 4 },
      { type: "DISCARD_RESHUFFLE_STARTED", playerId: "a", discardCount: 6 },
      { type: "DISCARD_RESHUFFLED", playerId: "a", drawPileCount: 6 },
      { type: "CARD_DRAWN", playerId: "a", count: 1, drawPileCount: 5, handCount: 4 },
      { type: "ROUND_FINISHED", roundNumber: 4 },
    ]);
    expect(sequences.map((sequence) => sequence.type)).toEqual([
      "ROUND",
      "DECK",
      "ROUND_SUMMARY",
    ]);
    expect(getCombatPlaybackSteps(sequences[1]!).map((entry) => entry.stage))
      .toEqual([
        "turn-intro",
        "reshuffle-start",
        "reshuffle-shuffle",
        "reshuffle-complete",
        "draw",
        "result",
      ]);
    expect(getCombatPlaybackSteps(sequences[2]!)).toEqual([
      {
        stage: "summary",
        durationMs: PLAYBACK_BEAT_MS * COMBAT_PLAYBACK_BEATS.turnSummary,
      },
    ]);
  });
});
