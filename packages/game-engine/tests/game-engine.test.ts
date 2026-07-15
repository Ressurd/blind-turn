import { describe, expect, it } from "vitest";
import {
  BASE_DECK_CARD_IDS,
  CARD_CATALOG,
  CHARACTER_CATALOG,
  GUARDIAN_MAX_HP,
  HP_SCALE,
  MAX_DECK_SIZE,
  SequenceRandomSource,
  SeededRandomSource,
  chooseInitialHand,
  confirmRound,
  createGame,
  getAllDeckCards,
  getDeckSize,
  prepareRewardOptions,
  queueCard,
  removeQueuedCard,
  reorderQueuedCards,
  resolveRound,
  selectDeckRemoval,
  selectReward,
  startRound,
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
  it("defines four characters, 27 cards, and the exact eight-card base deck", () => {
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
      "BASE_COUNTER",
    ]);
  });

  it("deals 3 cards, draws one from round 2, caps the hand at 5, and reshuffles discard", () => {
    let state = selectingState();
    const player = state.players[0]!;
    expect(player.deckState.hand).toHaveLength(3);
    expect(getDeckSize(player.deckState)).toBe(8);

    state.phase = "ROUND_STARTING";
    state = startRound(state, new SeededRandomSource(4));
    expect(state.players[0]!.deckState.hand).toHaveLength(4);

    state.phase = "ROUND_STARTING";
    state = startRound(state, new SeededRandomSource(5));
    expect(state.players[0]!.deckState.hand).toHaveLength(5);

    state.players[0]!.deckState.drawPile = [];
    state.players[0]!.deckState.discardPile = [{ instanceId: "reshuffle", cardId: "BASE_GUARD" }];
    state.players[0]!.deckState.hand.pop();
    state.phase = "ROUND_STARTING";
    state = startRound(state, new SeededRandomSource(6));
    expect(state.players[0]!.deckState.hand.some((card) => card.instanceId === "reshuffle")).toBe(true);
  });

  it("lets Tactician inspect 4 opening cards and keep exactly 3", () => {
    const state = createGame(players(["TACTICIAN", "DUELIST"]), new SeededRandomSource(1));
    const tactician = state.players[0]!;
    expect(tactician.deckState.pendingInitialHandSelection).toHaveLength(4);
    const selected = tactician.deckState.pendingInitialHandSelection.slice(0, 3).map((card) => card.instanceId);
    const chosen = chooseInitialHand(state, tactician.id, selected);
    expect(chosen.players[0]!.deckState.hand).toHaveLength(3);
    expect(chosen.players[0]!.deckState.discardPile).toHaveLength(1);
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

describe("reward and deck replacement", () => {
  it("offers 2 class + 1 common unique cards and grows 8→9→10", () => {
    let state = selectingState();
    state.players[1]!.alive = false;
    state = prepareRewardOptions(state, new SeededRandomSource(30));
    let options = state.players[0]!.deckState.pendingRewardOptions;
    expect(new Set(options).size).toBe(3);
    expect(options.filter((id) => CARD_CATALOG[id]!.classId === "DUELIST")).toHaveLength(2);
    expect(options.filter((id) => CARD_CATALOG[id]!.classId === "COMMON")).toHaveLength(1);
    state = selectReward(state, "p1", options[0]!, new SeededRandomSource(31));
    expect(getDeckSize(state.players[0]!.deckState)).toBe(9);

    state = prepareRewardOptions(state, new SeededRandomSource(32));
    options = state.players[0]!.deckState.pendingRewardOptions;
    state = selectReward(state, "p1", options[0]!, new SeededRandomSource(33));
    expect(getDeckSize(state.players[0]!.deckState)).toBe(MAX_DECK_SIZE);
  });

  it("requires an old-card removal at size 10 and keeps at least one attack", () => {
    let state = selectingState();
    const player = state.players[0]!;
    player.deckState.drawPile.push(
      { instanceId: "bonus-1", cardId: "COMMON_FIRST_AID" },
      { instanceId: "bonus-2", cardId: "COMMON_QUICK_SUPPLY" },
    );
    state.players[1]!.alive = false;
    state = prepareRewardOptions(state, new SeededRandomSource(40));
    const reward = state.players[0]!.deckState.pendingRewardOptions[0]!;
    state = selectReward(state, "p1", reward, new SeededRandomSource(41));
    expect(state.phase).toBe("SELECTING_DECK_REMOVAL");
    const oldCard = getAllDeckCards(state.players[0]!.deckState).find(
      (card) => card.cardId === "BASE_GUARD",
    )!;
    state = selectDeckRemoval(state, "p1", oldCard.instanceId, new SeededRandomSource(42));
    expect(getDeckSize(state.players[0]!.deckState)).toBe(10);
    expect(getAllDeckCards(state.players[0]!.deckState).some((card) =>
      CARD_CATALOG[card.cardId]!.category === "ATTACK")).toBe(true);
    expect(state.phase).toBe("ROUND_STARTING");
  });
});
