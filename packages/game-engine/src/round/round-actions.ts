import { MAX_CARDS_PER_ROUND } from "../constants";
import { getCardDefinition } from "../cards/card-catalog";
import { cloneGameState } from "../state/game-state";
import type {
  GameErrorCode,
  GameState,
  PlayerState,
  QueuedCardAction,
  QueuedCardAdditionalSelection,
} from "../types";

export class GameEngineError extends Error {
  constructor(public readonly code: GameErrorCode) {
    super(code);
    this.name = "GameEngineError";
  }
}

function requireSelectingPlayer(
  state: GameState,
  playerId: string,
  roundNumber: number,
): PlayerState {
  if (state.phase !== "SELECTING_CARDS") {
    throw new GameEngineError("INVALID_GAME_PHASE");
  }
  if (state.roundNumber !== roundNumber) {
    throw new GameEngineError("ROUND_NUMBER_MISMATCH");
  }
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error(`Unknown player: ${playerId}`);
  if (!player.alive) throw new GameEngineError("PLAYER_DEAD");
  if (player.deckState.confirmed) {
    throw new GameEngineError("ROUND_ALREADY_CONFIRMED");
  }
  return player;
}

function validateTarget(
  state: GameState,
  player: PlayerState,
  targetType: "NONE" | "ENEMY" | "SELF",
  targetPlayerId: string | undefined,
): void {
  if (targetType === "ENEMY") {
    const target = state.players.find(
      (candidate) => candidate.id === targetPlayerId,
    );
    if (!target || !target.alive || target.id === player.id) {
      throw new GameEngineError("INVALID_CARD_TARGET");
    }
    return;
  }
  if (targetPlayerId && targetPlayerId !== player.id) {
    throw new GameEngineError("INVALID_CARD_TARGET");
  }
}

function validateAdditionalSelection(
  player: PlayerState,
  cardId: string,
  additionalSelection: QueuedCardAdditionalSelection | undefined,
): void {
  const queuedIds = new Set(
    player.deckState.queuedCards.map((queued) => queued.cardInstanceId),
  );
  if (cardId === "TACTICIAN_RECYCLE") {
    if (
      !additionalSelection
      || !("discardCardInstanceId" in additionalSelection)
      || !player.deckState.discardPile.some(
        (card) => card.instanceId === additionalSelection.discardCardInstanceId,
      )
    ) {
      throw new GameEngineError("INVALID_ADDITIONAL_SELECTION");
    }
    return;
  }
  if (cardId === "TACTICIAN_SWAP") {
    if (
      !additionalSelection
      || !("handCardInstanceIds" in additionalSelection)
      || additionalSelection.handCardInstanceIds.length > 2
      || new Set(additionalSelection.handCardInstanceIds).size
        !== additionalSelection.handCardInstanceIds.length
      || additionalSelection.handCardInstanceIds.some(
        (instanceId) =>
          queuedIds.has(instanceId)
          || !player.deckState.hand.some((card) => card.instanceId === instanceId),
      )
    ) {
      throw new GameEngineError("INVALID_ADDITIONAL_SELECTION");
    }
    return;
  }
  if (cardId === "TACTICIAN_SIFT") {
    if (
      !additionalSelection
      || !("returnCardInstanceId" in additionalSelection)
      || queuedIds.has(additionalSelection.returnCardInstanceId)
      || !player.deckState.hand.some(
        (card) => card.instanceId === additionalSelection.returnCardInstanceId,
      )
    ) {
      throw new GameEngineError("INVALID_ADDITIONAL_SELECTION");
    }
    return;
  }
  if (additionalSelection !== undefined && additionalSelection !== null) {
    throw new GameEngineError("INVALID_ADDITIONAL_SELECTION");
  }
}

export function queueCard(
  state: GameState,
  playerId: string,
  roundNumber: number,
  input: Omit<QueuedCardAction, "order">,
): GameState {
  const next = cloneGameState(state);
  const player = requireSelectingPlayer(next, playerId, roundNumber);
  if (player.deckState.queuedCards.length >= MAX_CARDS_PER_ROUND) {
    throw new GameEngineError("MAX_QUEUED_CARDS_EXCEEDED");
  }
  if (
    player.deckState.queuedCards.some(
      (queued) => queued.cardInstanceId === input.cardInstanceId,
    )
  ) {
    throw new GameEngineError("CARD_ALREADY_QUEUED");
  }
  const card = player.deckState.hand.find(
    (candidate) => candidate.instanceId === input.cardInstanceId,
  );
  if (!card) throw new GameEngineError("CARD_NOT_IN_HAND");
  const reservedIds = new Set(
    player.deckState.queuedCards.flatMap((queued) => {
      const selection = queued.additionalSelection;
      if (!selection) return [];
      if ("handCardInstanceIds" in selection) return selection.handCardInstanceIds;
      if ("returnCardInstanceId" in selection) return [selection.returnCardInstanceId];
      return [];
    }),
  );
  if (reservedIds.has(input.cardInstanceId)) {
    throw new GameEngineError("INVALID_ADDITIONAL_SELECTION");
  }
  const definition = getCardDefinition(card.cardId);
  validateTarget(next, player, definition.targetType, input.targetPlayerId);
  validateAdditionalSelection(player, card.cardId, input.additionalSelection);
  const order = player.deckState.queuedCards.length as 0 | 1 | 2;
  player.deckState.queuedCards.push({
    cardInstanceId: input.cardInstanceId,
    order,
    ...(input.targetPlayerId ? { targetPlayerId: input.targetPlayerId } : {}),
    additionalSelection: input.additionalSelection ?? null,
  });
  return next;
}

export function removeQueuedCard(
  state: GameState,
  playerId: string,
  roundNumber: number,
  cardInstanceId: string,
): GameState {
  const next = cloneGameState(state);
  const player = requireSelectingPlayer(next, playerId, roundNumber);
  const index = player.deckState.queuedCards.findIndex(
    (queued) => queued.cardInstanceId === cardInstanceId,
  );
  if (index < 0) throw new GameEngineError("CARD_NOT_IN_HAND");
  player.deckState.queuedCards.splice(index, 1);
  player.deckState.queuedCards = player.deckState.queuedCards.map(
    (queued, order) => ({ ...queued, order: order as 0 | 1 | 2 }),
  );
  return next;
}

export function reorderQueuedCards(
  state: GameState,
  playerId: string,
  roundNumber: number,
  orderedInstanceIds: readonly string[],
): GameState {
  const next = cloneGameState(state);
  const player = requireSelectingPlayer(next, playerId, roundNumber);
  const currentIds = player.deckState.queuedCards.map(
    (queued) => queued.cardInstanceId,
  );
  if (
    orderedInstanceIds.length !== currentIds.length
    || new Set(orderedInstanceIds).size !== orderedInstanceIds.length
    || orderedInstanceIds.some((instanceId) => !currentIds.includes(instanceId))
  ) {
    throw new GameEngineError("INVALID_QUEUE_ORDER");
  }
  player.deckState.queuedCards = orderedInstanceIds.map((instanceId, order) => ({
    ...player.deckState.queuedCards.find(
      (queued) => queued.cardInstanceId === instanceId,
    )!,
    order: order as 0 | 1 | 2,
  }));
  return next;
}

export function confirmRound(
  state: GameState,
  playerId: string,
  roundNumber: number,
): GameState {
  const next = cloneGameState(state);
  const player = requireSelectingPlayer(next, playerId, roundNumber);
  player.deckState.confirmed = true;
  return next;
}

export function confirmMissingPlayers(state: GameState): GameState {
  if (state.phase !== "SELECTING_CARDS") {
    throw new GameEngineError("INVALID_GAME_PHASE");
  }
  const next = cloneGameState(state);
  for (const player of next.players.filter((candidate) => candidate.alive)) {
    if (player.deckState.confirmed) continue;
    player.deckState.queuedCards = [];
    player.deckState.confirmed = true;
  }
  return next;
}

export function haveAllAlivePlayersConfirmed(state: GameState): boolean {
  return state.players
    .filter((player) => player.alive)
    .every((player) => player.deckState.confirmed);
}
