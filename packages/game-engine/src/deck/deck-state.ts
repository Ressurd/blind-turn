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
    queuedCards: state.queuedCards.map((queued) => ({
      ...queued,
      additionalSelection: queued.additionalSelection
        ? JSON.parse(JSON.stringify(queued.additionalSelection)) as typeof queued.additionalSelection
        : null,
    })),
    confirmed: state.confirmed,
    pendingRewardOptions: [...state.pendingRewardOptions],
    pendingRewardCardId: state.pendingRewardCardId,
    pendingRemovalRequired: state.pendingRemovalRequired,
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
): ActionCardInstance | null {
  if (state.hand.length >= MAX_HAND_SIZE) return null;
  if (state.drawPile.length === 0 && state.discardPile.length > 0) {
    state.drawPile = randomSource
      .shuffle(state.discardPile)
      .map(cloneCardInstance);
    state.discardPile = [];
  }
  const card = state.drawPile.shift() ?? null;
  if (card) state.hand.push(card);
  return card;
}

export function drawCards(
  state: PlayerDeckState,
  count: number,
  randomSource: RandomSource,
): { state: PlayerDeckState; drawn: ActionCardInstance[] } {
  const next = cloneDeckState(state);
  const drawn: ActionCardInstance[] = [];
  for (let index = 0; index < count; index += 1) {
    const card = drawOne(next, randomSource);
    if (!card) break;
    drawn.push(cloneCardInstance(card));
  }
  return { state: next, drawn };
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
    queuedCards: [],
    confirmed: false,
    pendingRewardOptions: [],
    pendingRewardCardId: null,
    pendingRemovalRequired: false,
    pendingInitialHandSelection: [],
    nextInstanceNumber: deck.length + 1,
  };
  const drawCount = characterId === "TACTICIAN"
    ? TACTICIAN_INITIAL_DRAW_SIZE
    : INITIAL_HAND_SIZE;
  const dealt = drawCards(state, drawCount, randomSource).state;
  if (characterId === "TACTICIAN") {
    dealt.pendingInitialHandSelection = dealt.hand.map(cloneCardInstance);
  }
  return dealt;
}

export function selectInitialTacticianHand(
  state: PlayerDeckState,
  selectedInstanceIds: readonly string[],
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
  const discarded = next.hand.filter(
    (card) => !uniqueIds.has(card.instanceId),
  );
  next.hand = next.hand.filter((card) => uniqueIds.has(card.instanceId));
  next.discardPile.push(...discarded);
  next.pendingInitialHandSelection = [];
  return next;
}

export function insertNewCard(
  state: PlayerDeckState,
  playerId: string,
  cardId: string,
  randomSource: RandomSource,
): PlayerDeckState {
  const next = cloneDeckState(state);
  const instance = createCardInstance(
    playerId,
    cardId,
    next.nextInstanceNumber,
  );
  next.nextInstanceNumber += 1;
  const position = randomSource.nextInt(
    0,
    next.drawPile.length,
    "INSERT",
  );
  next.drawPile.splice(position, 0, instance);
  return next;
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
