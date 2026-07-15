import { describe, expect, it } from "vitest";
import {
  BASE_DECK_CARD_IDS,
  CARD_CATALOG,
  CHARACTER_CATALOG,
  GUARDIAN_MAX_HP,
  HP_SCALE,
  MAX_TOTAL_DECK_SIZE,
  SequenceRandomSource,
  SeededRandomSource,
  clearAction,
  confirmAction,
  confirmDeckRemoval,
  confirmMissingPlayers,
  confirmRewardSelection,
  createGame,
  getAllDeckCards,
  getDeckSize,
  prepareRewardOptions,
  resolveRound,
  selectAction,
  selectRandomPendingRewards,
  startRound,
  updateDeckRemovalSelection,
  updateRewardSelection,
  type CharacterClassId,
  type GameState,
  type RandomSource,
} from "../src";

const hp = (value: number) => value * HP_SCALE;

function players(classes: CharacterClassId[] = ["DUELIST", "BERSERKER"]) {
  return classes.map((characterId, index) => ({
    id: `p${index + 1}`,
    nickname: `P${index + 1}`,
    seatNumber: index + 1,
    characterId,
  }));
}

function selectingState(classes?: CharacterClassId[]): GameState {
  return startRound(
    createGame(players(classes), new SeededRandomSource(10)),
    new SeededRandomSource(11),
  );
}

function setHand(state: GameState, playerId: string, cardIds: string[]): void {
  const player = state.players.find((candidate) => candidate.id === playerId)!;
  player.deckState.hand = cardIds.map((cardId, index) => ({
    instanceId: `${playerId}:test:${index}:${cardId}`,
    cardId,
  }));
  player.deckState.selectedAction = null;
  player.deckState.confirmed = false;
}

function choose(
  state: GameState,
  playerId: string,
  cardIndex: number,
  targetPlayerId?: string,
): GameState {
  const card = state.players.find((player) => player.id === playerId)!
    .deckState.hand[cardIndex]!;
  return selectAction(state, playerId, state.roundNumber, {
    cardInstanceId: card.instanceId,
    ...(targetPlayerId ? { targetPlayerId } : {}),
    additionalSelection: null,
  });
}

function confirmAll(state: GameState): GameState {
  let next = state;
  for (const player of next.players.filter((candidate) => candidate.alive)) {
    next = confirmAction(next, player.id, next.roundNumber);
  }
  return next;
}

function resolved(
  state: GameState,
  random: RandomSource = new SeededRandomSource(20),
) {
  return resolveRound(confirmAll(state), random);
}

describe("catalog and opening deck", () => {
  it("defines four characters, 27 cards, and the exact ten-card base deck", () => {
    expect(Object.keys(CHARACTER_CATALOG)).toHaveLength(4);
    expect(Object.keys(CARD_CATALOG)).toHaveLength(27);
    expect(BASE_DECK_CARD_IDS).toHaveLength(10);
  });

  it("starts every class, including Tactician, with a normal five-card hand", () => {
    const state = createGame(
      players(["TACTICIAN", "DUELIST"]),
      new SeededRandomSource(1),
    );
    const tactician = state.players[0]!;
    expect(tactician.deckState.hand).toHaveLength(5);
    expect(tactician.deckState.drawPile).toHaveLength(5);
    expect(tactician.deckState.discardPile).toHaveLength(0);
    expect(CHARACTER_CATALOG.TACTICIAN.passive).toContain("성장");
  });

  it("draws at most one card per new turn and reshuffles discard", () => {
    let state = selectingState();
    expect(state.players[0]!.deckState.hand).toHaveLength(5);
    state.players[0]!.deckState.drawPile = [];
    state.players[0]!.deckState.discardPile = [
      { instanceId: "reshuffle", cardId: "BASE_GUARD" },
    ];
    state.players[0]!.deckState.hand.pop();
    state.phase = "ROUND_STARTING";
    state = startRound(state, new SeededRandomSource(6));
    expect(state.players[0]!.deckState.hand).toHaveLength(5);
    expect(state.pendingEvents.map((event) => event.type)).toContain(
      "DISCARD_RESHUFFLED",
    );
  });

  it("keeps Guardian's 35 HP passive", () => {
    const state = createGame(
      players(["GUARDIAN", "DUELIST"]),
      new SeededRandomSource(2),
    );
    expect(state.players[0]!.hp).toBe(GUARDIAN_MAX_HP);
  });
});

describe("single turn action", () => {
  it("stores at most one action and a later selection replaces it", () => {
    let state = selectingState();
    setHand(state, "p1", ["BASE_QUICK_STRIKE", "BASE_GUARD"]);
    state = choose(state, "p1", 0, "p2");
    const firstId = state.players[0]!.deckState.selectedAction!.cardInstanceId;
    state = choose(state, "p1", 1);
    expect(state.players[0]!.deckState.selectedAction).toEqual(
      expect.objectContaining({
        cardInstanceId: state.players[0]!.deckState.hand[1]!.instanceId,
      }),
    );
    expect(state.players[0]!.deckState.selectedAction!.cardInstanceId).not.toBe(
      firstId,
    );
  });

  it("clears an action and confirms PASS without consuming a card", () => {
    let state = selectingState();
    setHand(state, "p1", ["BASE_GUARD"]);
    const before = getDeckSize(state.players[0]!.deckState);
    state = choose(state, "p1", 0);
    state = clearAction(state, "p1", state.roundNumber);
    state = confirmAction(state, "p1", state.roundNumber);
    state = confirmAction(state, "p2", state.roundNumber);
    const result = resolveRound(state, new SeededRandomSource(2));
    expect(getDeckSize(result.state.players[0]!.deckState)).toBe(before);
    expect(result.events.some((event) => event.type === "CARD_REVEALED")).toBe(
      false,
    );
  });

  it("turn timeout converts every unconfirmed player to PASS", () => {
    let state = selectingState();
    setHand(state, "p1", ["BASE_QUICK_STRIKE"]);
    state = choose(state, "p1", 0, "p2");
    state = confirmMissingPlayers(state);
    expect(state.players.every((player) => player.deckState.confirmed)).toBe(true);
    expect(state.players.every((player) => player.deckState.selectedAction === null))
      .toBe(true);
  });
});

describe("simultaneous turn resolver", () => {
  it("applies Quick Strike 3 damage and Berserker's +1 attack damage", () => {
    let state = selectingState(["BERSERKER", "DUELIST"]);
    setHand(state, "p1", ["BASE_QUICK_STRIKE"]);
    setHand(state, "p2", []);
    state = choose(state, "p1", 0, "p2");
    const result = resolved(state);
    expect(result.state.players[1]!.hp).toBe(hp(26));
    expect(result.events).toContainEqual(expect.objectContaining({
      type: "DAMAGE_APPLIED",
      playerId: "p2",
      damage: hp(4),
    }));
  });

  it("reduces total incoming attack damage with Guard", () => {
    let state = selectingState();
    setHand(state, "p1", ["BASE_HEAVY_STRIKE"]);
    setHand(state, "p2", ["BASE_GUARD"]);
    state = choose(state, "p1", 0, "p2");
    state = choose(state, "p2", 0);
    const result = resolved(state);
    expect(result.state.players[1]!.hp).toBe(hp(30));
    expect(result.events).toContainEqual(expect.objectContaining({
      type: "GUARD_RESOLVED",
      incomingDamage: hp(5),
      finalDamage: 0,
    }));
  });

  it("does no damage on evade success and applies fixed 10 on failure", () => {
    const setup = () => {
      let state = selectingState();
      setHand(state, "p1", ["BASE_QUICK_STRIKE"]);
      setHand(state, "p2", ["BASE_EVADE"]);
      state = choose(state, "p1", 0, "p2");
      return choose(state, "p2", 0);
    };
    const success = resolved(
      setup(),
      new SequenceRandomSource({ EVADE: [8] }),
    );
    expect(success.state.players[1]!.hp).toBe(hp(30));
    expect(success.events.some((event) => event.type === "DAMAGE_APPLIED")).toBe(
      false,
    );
    const failure = resolved(
      setup(),
      new SequenceRandomSource({ EVADE: [7] }),
    );
    expect(failure.state.players[1]!.hp).toBe(hp(20));
    expect(failure.events).toContainEqual(expect.objectContaining({
      type: "DAMAGE_APPLIED",
      damage: hp(10),
      source: "EVADE_FAILURE",
    }));
  });

  it("cancels the triggering attack and resolves counter damage simultaneously", () => {
    let state = selectingState();
    setHand(state, "p1", ["BASE_QUICK_STRIKE"]);
    setHand(state, "p2", ["BASE_COUNTER"]);
    state = choose(state, "p1", 0, "p2");
    state = choose(state, "p2", 0, "p1");
    const result = resolved(state);
    expect(result.state.players[0]!.hp).toBe(hp(20));
    expect(result.state.players[1]!.hp).toBe(hp(27.5));
  });

  it("resolves mutual attacks as one clash with no next-action penalty", () => {
    let state = selectingState(["DUELIST", "BERSERKER"]);
    setHand(state, "p1", ["BASE_QUICK_STRIKE"]);
    setHand(state, "p2", ["BASE_HEAVY_STRIKE"]);
    state = choose(state, "p1", 0, "p2");
    state = choose(state, "p2", 0, "p1");
    const result = resolved(
      state,
      new SequenceRandomSource({ CLASH: [4, 6] }),
    );
    expect(result.events).toContainEqual({
      type: "CLASH_ROLLED",
      playerId: "p1",
      roll: 4,
      bonus: 3,
      total: 7,
    });
    expect(result.events).toContainEqual(expect.objectContaining({
      type: "CLASH_RESOLVED",
      winnerId: "p1",
      loserId: "p2",
    }));
    expect(result.events.map((event) => event.type)).not.toContain(
      "CLASH_LOSS_PENALTY_APPLIED",
    );
    expect(result.state.players.every((player) =>
      player.deckState.discardPile.length === 1
    )).toBe(true);
  });

  it("resolves a confirmed action even when its actor dies in the same turn", () => {
    let state = selectingState(["DUELIST", "DUELIST", "DUELIST"]);
    setHand(state, "p1", ["BASE_HEAVY_STRIKE"]);
    setHand(state, "p2", ["BASE_QUICK_STRIKE"]);
    setHand(state, "p3", []);
    state.players[1]!.hp = hp(5);
    state = choose(state, "p1", 0, "p2");
    state = choose(state, "p2", 0, "p3");
    const result = resolved(state);
    expect(result.state.players[1]).toMatchObject({ hp: 0, alive: false });
    expect(result.state.players[2]!.hp).toBe(hp(27));
  });
});

describe("growth rewards", () => {
  it("offers normal classes 2 class + 1 common and Tactician 3 class + 1 common", () => {
    const state = prepareRewardOptions(
      selectingState(["DUELIST", "TACTICIAN"]),
      new SeededRandomSource(30),
    );
    const normal = state.players[0]!.deckState.pendingRewardOptions;
    const tactician = state.players[1]!.deckState.pendingRewardOptions;
    expect(normal).toHaveLength(3);
    expect(normal.filter((id) => CARD_CATALOG[id]!.classId === "DUELIST"))
      .toHaveLength(2);
    expect(normal.filter((id) => CARD_CATALOG[id]!.classId === "COMMON"))
      .toHaveLength(1);
    expect(tactician).toHaveLength(4);
    expect(new Set(tactician).size).toBe(4);
    expect(tactician.filter((id) => CARD_CATALOG[id]!.classId === "TACTICIAN"))
      .toHaveLength(3);
    expect(tactician.filter((id) => CARD_CATALOG[id]!.classId === "COMMON"))
      .toHaveLength(1);
  });

  it("fills unavailable Tactician class slots with unique common cards", () => {
    const state = selectingState(["TACTICIAN", "DUELIST"]);
    const tactician = state.players[0]!;
    for (const cardId of ["TACTICIAN_RECYCLE", "TACTICIAN_SWAP"]) {
      tactician.deckState.drawPile.push(
        { instanceId: `${cardId}:1`, cardId },
        { instanceId: `${cardId}:2`, cardId },
      );
    }
    const rewarded = prepareRewardOptions(state, new SeededRandomSource(31));
    const options = rewarded.players[0]!.deckState.pendingRewardOptions;
    expect(options).toHaveLength(4);
    expect(new Set(options).size).toBe(4);
    expect(options.filter((id) => CARD_CATALOG[id]!.classId === "COMMON"))
      .toHaveLength(2);
  });

  it("requires exactly two selections for both 3- and 4-option rewards", () => {
    let state = prepareRewardOptions(
      selectingState(["TACTICIAN", "DUELIST"]),
      new SeededRandomSource(32),
    );
    const options = state.players[0]!.deckState.pendingRewardOptions;
    expect(() => confirmRewardSelection(state, "p1", new SeededRandomSource(1)))
      .toThrow("INVALID_REWARD_SELECTION");
    state = updateRewardSelection(state, "p1", [options[0]!]);
    expect(() => confirmRewardSelection(state, "p1", new SeededRandomSource(1)))
      .toThrow("INVALID_REWARD_SELECTION");
    expect(() => updateRewardSelection(state, "p1", options.slice(0, 3)))
      .toThrow("INVALID_REWARD_SELECTION");
    expect(() => updateRewardSelection(state, "p1", options))
      .toThrow("INVALID_REWARD_SELECTION");
  });

  it("adds exactly two cards and timeout auto-selects two distinct options", () => {
    let state = prepareRewardOptions(
      selectingState(["TACTICIAN", "DUELIST"]),
      new SeededRandomSource(33),
    );
    const before = getDeckSize(state.players[0]!.deckState);
    state = selectRandomPendingRewards(state, new SeededRandomSource(34));
    expect(getDeckSize(state.players[0]!.deckState)).toBe(before + 2);
    expect(new Set(state.players[0]!.deckState.selectedRewardCardIds).size).toBe(2);
  });

  it("opens growth after turn 3 and keeps the 15-card maximum after trimming", () => {
    let state = selectingState(["DUELIST", "BERSERKER"]);
    state.roundNumber = 3;
    const result = resolved(state);
    expect(result.state.phase).toBe("SELECTING_REWARD");

    state = result.state;
    state.players[1]!.alive = false;
    const options = state.players[0]!.deckState.pendingRewardOptions;
    state = updateRewardSelection(state, "p1", options.slice(0, 2));
    state = confirmRewardSelection(state, "p1", new SeededRandomSource(35));
    expect(getDeckSize(state.players[0]!.deckState)).toBe(12);

    state.players[0]!.deckState.drawPile.push(
      { instanceId: "extra-1", cardId: "COMMON_FIRST_AID" },
      { instanceId: "extra-2", cardId: "COMMON_QUICK_SUPPLY" },
      { instanceId: "extra-3", cardId: "COMMON_GAMBLE" },
    );
    state = prepareRewardOptions(state, new SeededRandomSource(36));
    const nextOptions = state.players[0]!.deckState.pendingRewardOptions;
    state = updateRewardSelection(state, "p1", nextOptions.slice(0, 2));
    state = confirmRewardSelection(state, "p1", new SeededRandomSource(37));
    expect(state.phase).toBe("SELECTING_DECK_REMOVAL");
    const removable = getAllDeckCards(state.players[0]!.deckState)
      .filter((card) => !state.players[0]!.deckState.newlyAddedCardInstanceIds.includes(card.instanceId))
      .slice(0, state.players[0]!.deckState.requiredRemovalCount);
    state = updateDeckRemovalSelection(
      state,
      "p1",
      removable.map((card) => card.instanceId),
    );
    state = confirmDeckRemoval(state, "p1");
    expect(getDeckSize(state.players[0]!.deckState)).toBe(MAX_TOTAL_DECK_SIZE);
  });
});
