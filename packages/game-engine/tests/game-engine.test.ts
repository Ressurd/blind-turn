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
  chooseInitialHand,
  confirmDeckRemoval,
  confirmRewardSelection,
  confirmRound,
  createGame,
  getAllDeckCards,
  getDeckSize,
  moveQueuedCard,
  prepareRewardOptions,
  queueCard,
  removeQueuedCard,
  reorderQueuedCards,
  resolveRound,
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
  const created = createGame(players(classes), new SeededRandomSource(10));
  return startRound(created, new SeededRandomSource(11));
}

function setHand(state: GameState, playerId: string, cardIds: string[]): void {
  const player = state.players.find((candidate) => candidate.id === playerId)!;
  player.deckState.hand = cardIds.map((cardId, index) => ({
    instanceId: `${playerId}:test:${index}:${cardId}`,
    cardId,
  }));
  player.deckState.queuedCards = [];
  player.deckState.confirmed = false;
}

function addQueue(
  state: GameState,
  playerId: string,
  cardIndex: number,
  targetPlayerId?: string,
): GameState {
  const card = state.players.find((player) => player.id === playerId)!.deckState.hand[cardIndex]!;
  return queueCard(state, playerId, state.roundNumber, {
    cardInstanceId: card.instanceId,
    ...(targetPlayerId ? { targetPlayerId } : {}),
    additionalSelection: null,
  });
}

function confirmAll(state: GameState): GameState {
  let next = state;
  for (const player of next.players.filter((candidate) => candidate.alive)) {
    next = confirmRound(next, player.id, next.roundNumber);
  }
  return next;
}

function resolved(
  state: GameState,
  random: RandomSource = new SeededRandomSource(20),
) {
  return resolveRound(confirmAll(state), random);
}

describe("V2 catalogs and deck lifecycle", () => {
  it("defines four characters, 27 cards, and the exact ten-card base deck", () => {
    expect(Object.keys(CHARACTER_CATALOG)).toHaveLength(4);
    expect(Object.keys(CARD_CATALOG)).toHaveLength(27);
    expect(BASE_DECK_CARD_IDS).toEqual([
      "BASE_QUICK_STRIKE",
      "BASE_QUICK_STRIKE",
      "BASE_HEAVY_STRIKE",
      "BASE_HEAVY_STRIKE",
      "BASE_GUARD",
      "BASE_GUARD",
      "BASE_EVADE",
      "BASE_EVADE",
      "BASE_COUNTER",
      "BASE_COUNTER",
    ]);
  });

  it("deals 5 cards, draws only one when below 5, and reshuffles discard", () => {
    let state = selectingState();
    const player = state.players[0]!;
    expect(player.deckState.hand).toHaveLength(5);
    expect(getDeckSize(player.deckState)).toBe(10);

    state.phase = "ROUND_STARTING";
    state = startRound(state, new SeededRandomSource(4));
    expect(state.players[0]!.deckState.hand).toHaveLength(5);

    state.players[0]!.deckState.drawPile = [];
    state.players[0]!.deckState.discardPile = [{ instanceId: "reshuffle", cardId: "BASE_GUARD" }];
    state.players[0]!.deckState.hand.pop();
    state.phase = "ROUND_STARTING";
    state = startRound(state, new SeededRandomSource(6));
    expect(state.players[0]!.deckState.hand.some((card) => card.instanceId === "reshuffle")).toBe(true);
    expect(state.pendingEvents.filter((event) => "playerId" in event && event.playerId === "p1").map((event) => event.type)).toEqual([
      "DISCARD_RESHUFFLE_STARTED",
      "DISCARD_RESHUFFLED",
      "CARD_DRAWN",
    ]);
  });

  it("lets Tactician inspect 6 opening cards and keep exactly 5", () => {
    const state = createGame(players(["TACTICIAN", "DUELIST"]), new SeededRandomSource(1));
    const tactician = state.players[0]!;
    expect(tactician.deckState.pendingInitialHandSelection).toHaveLength(6);
    const selected = tactician.deckState.pendingInitialHandSelection.slice(0, 5).map((card) => card.instanceId);
    const chosen = chooseInitialHand(state, tactician.id, selected, new SeededRandomSource(2));
    expect(chosen.players[0]!.deckState.hand).toHaveLength(5);
    expect(chosen.players[0]!.deckState.drawPile).toHaveLength(5);
    expect(chosen.players[0]!.deckState.discardPile).toHaveLength(0);
  });

  it("applies Guardian 35 HP and the other class passives from data", () => {
    const state = createGame(players(["GUARDIAN", "DUELIST"]), new SeededRandomSource(2));
    expect(state.players[0]!.hp).toBe(GUARDIAN_MAX_HP);
    expect(CHARACTER_CATALOG.DUELIST.passive).toContain("+1");
    expect(CHARACTER_CATALOG.BERSERKER.passive).toContain("1 증가");
  });
});

describe("private queue", () => {
  it("supports zero to three cards, removal, and reordering before confirmation", () => {
    let state = selectingState();
    setHand(state, "p1", ["BASE_QUICK_STRIKE", "BASE_GUARD", "BASE_EVADE"]);
    const ids = state.players[0]!.deckState.hand.map((card) => card.instanceId);
    state = addQueue(state, "p1", 0, "p2");
    state = addQueue(state, "p1", 1);
    state = addQueue(state, "p1", 2);
    expect(state.players[0]!.deckState.queuedCards).toHaveLength(3);
    expect(state.players[0]!.deckState.queuedCards.map((queued) => queued.order)).toEqual([0, 1, 2]);

    state = reorderQueuedCards(state, "p1", state.roundNumber, [ids[2]!, ids[0]!, ids[1]!]);
    expect(state.players[0]!.deckState.queuedCards.map((queued) => queued.cardInstanceId)).toEqual([
      ids[2], ids[0], ids[1],
    ]);
    state = removeQueuedCard(state, "p1", state.roundNumber, ids[0]!);
    expect(state.players[0]!.deckState.queuedCards.map((queued) => queued.order)).toEqual([0, 1]);

    const zeroCardPlayer = confirmRound(state, "p2", state.roundNumber);
    expect(zeroCardPlayer.players[1]!.deckState.confirmed).toBe(true);
    expect(zeroCardPlayer.players[1]!.deckState.queuedCards).toEqual([]);
  });

  it("always appends to the first open order and keeps edited order contiguous", () => {
    let state = selectingState();
    setHand(state, "p1", ["BASE_GUARD", "BASE_QUICK_STRIKE"]);
    const [guard, attack] = state.players[0]!.deckState.hand;
    state = queueCard(state, "p1", state.roundNumber, {
      cardInstanceId: attack!.instanceId,
      targetPlayerId: "p2",
      order: 2,
      additionalSelection: null,
    });
    state = queueCard(state, "p1", state.roundNumber, {
      cardInstanceId: guard!.instanceId,
      order: 0,
      additionalSelection: null,
    });
    expect(state.players[0]!.deckState.queuedCards.map((queued) => [queued.cardInstanceId, queued.order])).toEqual([
      [attack!.instanceId, 0],
      [guard!.instanceId, 1],
    ]);
    state = moveQueuedCard(state, "p1", state.roundNumber, guard!.instanceId, 0);
    expect(state.players[0]!.deckState.queuedCards.map((queued) => [queued.cardInstanceId, queued.order])).toEqual([
      [guard!.instanceId, 0],
      [attack!.instanceId, 1],
    ]);
  });

  it("rejects a fourth queued card and hides no random initiative fields in state", () => {
    let state = selectingState();
    setHand(state, "p1", ["BASE_QUICK_STRIKE", "BASE_HEAVY_STRIKE", "BASE_GUARD", "BASE_EVADE"]);
    state = addQueue(state, "p1", 0, "p2");
    state = addQueue(state, "p1", 1, "p2");
    state = addQueue(state, "p1", 2);
    expect(() => addQueue(state, "p1", 3)).toThrow("MAX_QUEUED_CARDS_EXCEEDED");
    expect(state).not.toHaveProperty("actionOrder");
    expect(state.players[0]).not.toHaveProperty("speedRoll");
    expect(state.players[0]).not.toHaveProperty("hiddenTieRoll");
  });
});

describe("step resolver", () => {
  it("applies Quick Strike 3 damage and Berserker's direct attack +1", () => {
    let state = selectingState(["BERSERKER", "DUELIST"]);
    setHand(state, "p1", ["BASE_QUICK_STRIKE"]);
    setHand(state, "p2", []);
    state = addQueue(state, "p1", 0, "p2");
    const result = resolved(state);
    expect(result.state.players[1]!.hp).toBe(hp(26));
    expect(result.events).toContainEqual(expect.objectContaining({
      type: "DAMAGE_APPLIED",
      playerId: "p2",
      damage: hp(4),
    }));
  });

  it("reduces the step's total attack damage by 5 with base Guard", () => {
    let state = selectingState();
    setHand(state, "p1", ["BASE_HEAVY_STRIKE"]);
    setHand(state, "p2", ["BASE_GUARD"]);
    state = addQueue(state, "p1", 0, "p2");
    state = addQueue(state, "p2", 0);
    const result = resolved(state);
    expect(result.state.players[1]!.hp).toBe(hp(30));
    expect(result.events).toContainEqual(expect.objectContaining({
      type: "GUARD_RESOLVED",
      incomingDamage: hp(5),
      finalDamage: 0,
    }));
  });

  it("keeps HP unchanged on evade success", () => {
    let state = selectingState();
    setHand(state, "p1", ["BASE_QUICK_STRIKE"]);
    setHand(state, "p2", ["BASE_EVADE"]);
    state = addQueue(state, "p1", 0, "p2");
    state = addQueue(state, "p2", 0);
    const result = resolved(state, new SequenceRandomSource({ EVADE: [8] }));
    expect(result.state.players[1]!.hp).toBe(hp(30));
    expect(result.events).toContainEqual(expect.objectContaining({
      type: "EVADE_ROLLED",
      succeeded: true,
    }));
    expect(result.events.some((event) => event.type === "DAMAGE_APPLIED")).toBe(false);
  });

  it("applies fixed 10 damage on the first evade failure", () => {
    let state = selectingState();
    setHand(state, "p1", ["BASE_QUICK_STRIKE"]);
    setHand(state, "p2", ["BASE_EVADE"]);
    state = addQueue(state, "p1", 0, "p2");
    state = addQueue(state, "p2", 0);
    const result = resolved(state, new SequenceRandomSource({ EVADE: [7] }));
    expect(result.state.players[1]!.hp).toBe(hp(20));
    expect(result.events).toContainEqual(expect.objectContaining({
      type: "DAMAGE_APPLIED",
      damage: hp(10),
      source: "EVADE_FAILURE",
    }));
  });

  it("cancels the original attack and applies counter 10 / self 2.5 simultaneously", () => {
    let state = selectingState();
    setHand(state, "p1", ["BASE_QUICK_STRIKE"]);
    setHand(state, "p2", ["BASE_COUNTER"]);
    state = addQueue(state, "p1", 0, "p2");
    state = addQueue(state, "p2", 0, "p1");
    const result = resolved(state);
    expect(result.state.players[0]!.hp).toBe(hp(20));
    expect(result.state.players[1]!.hp).toBe(hp(27.5));
    expect(result.events).toContainEqual(expect.objectContaining({
      type: "COUNTER_TRIGGERED",
      attackerDamage: hp(10),
      counterDamage: hp(2.5),
    }));
  });

  it("resolves mutual attacks as a clash with card and Duelist bonuses", () => {
    let state = selectingState(["DUELIST", "BERSERKER"]);
    setHand(state, "p1", ["BASE_QUICK_STRIKE"]);
    setHand(state, "p2", ["BASE_HEAVY_STRIKE"]);
    state = addQueue(state, "p1", 0, "p2");
    state = addQueue(state, "p2", 0, "p1");
    const result = resolved(state, new SequenceRandomSource({ CLASH: [4, 6] }));
    expect(result.events).toContainEqual({
      type: "CLASH_ROLLED",
      stepIndex: 0,
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
  });

  it("fires every current-step action before deaths, then cancels the dead player's later step", () => {
    let state = selectingState(["DUELIST", "DUELIST", "DUELIST"]);
    setHand(state, "p1", ["BASE_HEAVY_STRIKE"]);
    setHand(state, "p2", ["BASE_QUICK_STRIKE", "BASE_HEAVY_STRIKE"]);
    setHand(state, "p3", []);
    state.players[1]!.hp = hp(5);
    state = addQueue(state, "p1", 0, "p2");
    state = addQueue(state, "p2", 0, "p3");
    state = addQueue(state, "p2", 1, "p3");
    const result = resolved(state);
    expect(result.state.players[1]!.alive).toBe(false);
    expect(result.state.players[2]!.hp).toBe(hp(27));
    expect(result.events).toContainEqual(expect.objectContaining({
      type: "CARD_CANCELLED",
      playerId: "p2",
      reason: "PLAYER_DEAD",
      stepIndex: 1,
    }));
  });

  it("enters reward selection after every third round", () => {
    const state = selectingState();
    state.roundNumber = 3;
    const result = resolved(state);
    expect(result.state.phase).toBe("SELECTING_REWARD");
    expect(result.state.players.every((player) => player.deckState.pendingRewardOptions.length === 3)).toBe(true);
  });
});

describe("reward and permanent deck trimming", () => {
  function confirmTwoRewards(state: GameState, seed: number): GameState {
    const options = state.players[0]!.deckState.pendingRewardOptions;
    let next = updateRewardSelection(state, "p1", [options[0]!, options[2]!]);
    next = confirmRewardSelection(next, "p1", new SeededRandomSource(seed));
    return next;
  }

  it("offers 2 class + 1 common and requires exactly two selections", () => {
    let state = selectingState();
    state.players[1]!.alive = false;
    state = prepareRewardOptions(state, new SeededRandomSource(30));
    const options = state.players[0]!.deckState.pendingRewardOptions;
    expect(new Set(options).size).toBe(3);
    expect(options.filter((id) => CARD_CATALOG[id]!.classId === "DUELIST")).toHaveLength(2);
    expect(options.filter((id) => CARD_CATALOG[id]!.classId === "COMMON")).toHaveLength(1);
    expect(() => confirmRewardSelection(state, "p1", new SeededRandomSource(31))).toThrow("INVALID_REWARD_SELECTION");
    const one = updateRewardSelection(state, "p1", [options[0]!]);
    expect(() => confirmRewardSelection(one, "p1", new SeededRandomSource(31))).toThrow("INVALID_REWARD_SELECTION");
    expect(() => updateRewardSelection(state, "p1", options)).toThrow("INVALID_REWARD_SELECTION");
    state = confirmTwoRewards(state, 31);
    expect(getDeckSize(state.players[0]!.deckState)).toBe(12);
    expect(state.players[0]!.deckState.selectedRewardCardIds).toEqual([options[0], options[2]]);
  });

  it("grows 10→12→14, trims 16→15, then trims 17→15", () => {
    let state = selectingState();
    state.players[1]!.alive = false;
    for (const [prepareSeed, confirmSeed] of [[40, 41], [42, 43]] as const) {
      state = prepareRewardOptions(state, new SeededRandomSource(prepareSeed));
      state = confirmTwoRewards(state, confirmSeed);
    }
    expect(getDeckSize(state.players[0]!.deckState)).toBe(14);

    state = prepareRewardOptions(state, new SeededRandomSource(44));
    state = confirmTwoRewards(state, 45);
    expect(state.phase).toBe("SELECTING_DECK_REMOVAL");
    expect(getDeckSize(state.players[0]!.deckState)).toBe(16);
    expect(state.players[0]!.deckState.requiredRemovalCount).toBe(1);
    const newIds = [...state.players[0]!.deckState.newlyAddedCardInstanceIds];
    expect(() => updateDeckRemovalSelection(state, "p1", [newIds[0]!])).toThrow("INVALID_DECK_REMOVAL");
    const oldCard = getAllDeckCards(state.players[0]!.deckState).find(
      (card) => card.cardId === "BASE_GUARD",
    )!;
    state = updateDeckRemovalSelection(state, "p1", [oldCard.instanceId]);
    state = confirmDeckRemoval(state, "p1");
    expect(getDeckSize(state.players[0]!.deckState)).toBe(MAX_TOTAL_DECK_SIZE);
    expect(state.players[0]!.deckState.permanentlyRemovedCards).toContainEqual(oldCard);
    expect(getAllDeckCards(state.players[0]!.deckState).some((card) =>
      CARD_CATALOG[card.cardId]!.category === "ATTACK")).toBe(true);
    expect(state.phase).toBe("ROUND_STARTING");

    state = prepareRewardOptions(state, new SeededRandomSource(46));
    state = confirmTwoRewards(state, 47);
    expect(getDeckSize(state.players[0]!.deckState)).toBe(17);
    expect(state.players[0]!.deckState.requiredRemovalCount).toBe(2);
    const candidates = getAllDeckCards(state.players[0]!.deckState).filter(
      (card) => !state.players[0]!.deckState.newlyAddedCardInstanceIds.includes(card.instanceId),
    ).slice(0, 2);
    state = updateDeckRemovalSelection(state, "p1", candidates.map((card) => card.instanceId));
    state = confirmDeckRemoval(state, "p1");
    expect(getDeckSize(state.players[0]!.deckState)).toBe(15);
    expect(state.players[0]!.deckState.permanentlyRemovedCards).toHaveLength(3);
  });

  it("never reshuffles permanently removed cards and does not refill a trimmed hand", () => {
    let state = selectingState();
    state.players[1]!.alive = false;
    const player = state.players[0]!;
    player.deckState.drawPile.push(
      { instanceId: "extra-1", cardId: "COMMON_FIRST_AID" },
      { instanceId: "extra-2", cardId: "COMMON_QUICK_SUPPLY" },
      { instanceId: "extra-3", cardId: "COMMON_GAMBLE" },
      { instanceId: "extra-4", cardId: "COMMON_SMOKE_EVADE" },
      { instanceId: "extra-5", cardId: "COMMON_REINFORCED_GUARD" },
    );
    state = prepareRewardOptions(state, new SeededRandomSource(50));
    state = confirmTwoRewards(state, 51);
    const handCard = state.players[0]!.deckState.hand[0]!;
    const oldDrawCard = state.players[0]!.deckState.drawPile.find(
      (card) => !state.players[0]!.deckState.newlyAddedCardInstanceIds.includes(card.instanceId),
    )!;
    const beforeHand = state.players[0]!.deckState.hand.length;
    state = updateDeckRemovalSelection(state, "p1", [handCard.instanceId, oldDrawCard.instanceId]);
    state = confirmDeckRemoval(state, "p1");
    expect(state.players[0]!.deckState.hand).toHaveLength(beforeHand - 1);
    expect(getAllDeckCards(state.players[0]!.deckState)).not.toContainEqual(handCard);
    expect(state.players[0]!.deckState.permanentlyRemovedCards).toContainEqual(handCard);
  });
});
