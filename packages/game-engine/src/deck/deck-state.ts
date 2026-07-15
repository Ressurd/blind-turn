import {
  INITIAL_HAND_SIZE,
  MAX_HAND_SIZE,
  TACTICIAN_INITIAL_DRAW_SIZE,
} from "../constants";
import { BASE_DECK_CARD_IDS } from "../cards/card-catalog";
import type { RandomSource } from "../random";
import type {
  ActionCardInstance,
  CharacterClassId,
  PlayerDeckState,
} from "../types";

export function cloneCardInstance(
  card: ActionCardInstance,
): ActionCardInstance {
  return { ...card };
}

export function cloneDeckState(state: PlayerDeckState): PlayerDeckState {
  return {
    drawPile: state.drawPile.map(cloneCardInstance),
    hand: state.hand.map(cloneCardInstance),
    discardPile: state.discardPile.map(cloneCardInstance),
    permanentlyRemovedCards:
      state.permanentlyRemovedCards.map(cloneCardInstance),
    queuedCards: state.queuedCards.map((queued) => ({
      ...queued,
      additionalSelection: queued.additionalSelection
        ? JSON.parse(JSON.stringify(queued.additionalSelection)) as typeof queued.additionalSelection
        : null,
    })),
    confirmed: state.confirmed,
    pendingRewardOptions: [...state.pendingRewardOptions],
    selectedRewardCardIds: [...state.selectedRewardCardIds],
    rewardConfirmed: state.rewardConfirmed,
    requiredRemovalCount: state.requiredRemovalCount,
    selectedRemovalInstanceIds: [...state.selectedRemovalInstanceIds],
    newlyAddedCardInstanceIds: [...state.newlyAddedCardInstanceIds],
    deckRemovalConfirmed: state.deckRemovalConfirmed,
    pendingInitialHandSelection:
      state.pendingInitialHandSelection.map(cloneCardInstance),
    nextInstanceNumber: state.nextInstanceNumber,
  };
}

export function createCardInstance(
  playerId: string,
  cardId: string,
  instanceNumber: number,
): ActionCardInstance {
  return {
    instanceId: `${playerId}:card:${instanceNumber}`,
    cardId,
  };
}

function drawOne(
  state: PlayerDeckState,
  randomSource: RandomSource,
): {
  card: ActionCardInstance | null;
  reshuffled: { discardCount: number; drawPileCount: number } | null;
} {
  if (state.hand.length >= MAX_HAND_SIZE) return { card: null, reshuffled: null };
  let reshuffled: { discardCount: number; drawPileCount: number } | null = null;
  if (state.drawPile.length === 0 && state.discardPile.length > 0) {
    const discardCount = state.discardPile.length;
    state.drawPile = randomSource
      .shuffle(state.discardPile)
      .map(cloneCardInstance);
    state.discardPile = [];
    reshuffled = { discardCount, drawPileCount: state.drawPile.length };
  }
  const card = state.drawPile.shift() ?? null;
  if (card) state.hand.push(card);
  return { card, reshuffled };
}

export function drawCards(
  state: PlayerDeckState,
  count: number,
  randomSource: RandomSource,
): {
  state: PlayerDeckState;
  drawn: ActionCardInstance[];
  reshuffled: { discardCount: number; drawPileCount: number } | null;
} {
  const next = cloneDeckState(state);
  const drawn: ActionCardInstance[] = [];
  let reshuffled: { discardCount: number; drawPileCount: number } | null = null;
  for (let index = 0; index < count; index += 1) {
    const result = drawOne(next, randomSource);
    const { card } = result;
    reshuffled ??= result.reshuffled;
    if (!card) break;
    drawn.push(cloneCardInstance(card));
  }
  return { state: next, drawn, reshuffled };
}

export function createInitialDeckState(
  playerId: string,
  characterId: CharacterClassId,
  randomSource: RandomSource,
): PlayerDeckState {
  const deck = BASE_DECK_CARD_IDS.map((cardId, index) =>
    createCardInstance(playerId, cardId, index + 1),
  );
  const state: PlayerDeckState = {
    drawPile: randomSource.shuffle(deck).map(cloneCardInstance),
    hand: [],
    discardPile: [],
    permanentlyRemovedCards: [],
    queuedCards: [],
    confirmed: false,
    pendingRewardOptions: [],
    selectedRewardCardIds: [],
    rewardConfirmed: false,
    requiredRemovalCount: 0,
    selectedRemovalInstanceIds: [],
    newlyAddedCardInstanceIds: [],
    deckRemovalConfirmed: false,
    pendingInitialHandSelection: [],
    nextInstanceNumber: deck.length + 1,
  };
  if (characterId === "TACTICIAN") {
    const offered = state.drawPile.splice(0, TACTICIAN_INITIAL_DRAW_SIZE);
    state.hand.push(...offered);
    state.pendingInitialHandSelection = state.hand.map(cloneCardInstance);
    return state;
  }
  return drawCards(state, INITIAL_HAND_SIZE, randomSource).state;
}

export function selectInitialTacticianHand(
  state: PlayerDeckState,
  selectedInstanceIds: readonly string[],
  randomSource: RandomSource,
): PlayerDeckState {
  if (state.pendingInitialHandSelection.length !== TACTICIAN_INITIAL_DRAW_SIZE) {
    throw new Error("INITIAL_HAND_SELECTION_REQUIRED");
  }
  const uniqueIds = new Set(selectedInstanceIds);
  if (uniqueIds.size !== INITIAL_HAND_SIZE) {
    throw new Error("INITIAL_HAND_SELECTION_REQUIRED");
  }
  const offeredIds = new Set(
    state.pendingInitialHandSelection.map((card) => card.instanceId),
  );
  if ([...uniqueIds].some((instanceId) => !offeredIds.has(instanceId))) {
    throw new Error("INITIAL_HAND_SELECTION_REQUIRED");
  }
  const next = cloneDeckState(state);
  const returned = next.hand.filter(
    (card) => !uniqueIds.has(card.instanceId),
  );
  next.hand = next.hand.filter((card) => uniqueIds.has(card.instanceId));
  for (const card of returned) {
    const position = randomSource.nextInt(0, next.drawPile.length, "INSERT");
    next.drawPile.splice(position, 0, card);
  }
  next.pendingInitialHandSelection = [];
  return next;
}

export function insertNewCards(
  state: PlayerDeckState,
  playerId: string,
  cardIds: readonly string[],
  randomSource: RandomSource,
): { state: PlayerDeckState; inserted: ActionCardInstance[] } {
  const next = cloneDeckState(state);
  const inserted: ActionCardInstance[] = [];
  for (const cardId of cardIds) {
    const instance = createCardInstance(
      playerId,
      cardId,
      next.nextInstanceNumber,
    );
    next.nextInstanceNumber += 1;
    const position = randomSource.nextInt(0, next.drawPile.length, "INSERT");
    next.drawPile.splice(position, 0, instance);
    inserted.push(cloneCardInstance(instance));
  }
  return { state: next, inserted };
}

export function insertNewCard(
  state: PlayerDeckState,
  playerId: string,
  cardId: string,
  randomSource: RandomSource,
): PlayerDeckState {
  return insertNewCards(state, playerId, [cardId], randomSource).state;
}

export function getAllDeckCards(
  state: PlayerDeckState,
): ActionCardInstance[] {
  return [
    ...state.hand,
    ...state.drawPile,
    ...state.discardPile,
  ].map(cloneCardInstance);
}

export function getDeckSize(state: PlayerDeckState): number {
  return state.hand.length + state.drawPile.length + state.discardPile.length;
}

export function countCardCopies(
  state: PlayerDeckState,
  cardId: string,
): number {
  return getAllDeckCards(state).filter((card) => card.cardId === cardId).length;
}

export function removeCardInstance(
  state: PlayerDeckState,
  instanceId: string,
): { state: PlayerDeckState; removed: ActionCardInstance | null } {
  const next = cloneDeckState(state);
  for (const pile of [next.hand, next.drawPile, next.discardPile]) {
    const index = pile.findIndex((card) => card.instanceId === instanceId);
    if (index < 0) continue;
    const [removed] = pile.splice(index, 1);
    return { state: next, removed: removed ?? null };
  }
  return { state: next, removed: null };
}
