import { getCardDefinition } from "../cards/card-catalog";
import { cloneGameState } from "../state/game-state";
import type {
  GameErrorCode,
  GameState,
  PlayerState,
  SelectedActionAdditionalSelection,
  SelectedTurnAction,
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
  selectedCardInstanceId: string,
  additionalSelection: SelectedActionAdditionalSelection | undefined,
): void {
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
          instanceId === selectedCardInstanceId
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
      || additionalSelection.returnCardInstanceId === selectedCardInstanceId
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

export function selectAction(
  state: GameState,
  playerId: string,
  roundNumber: number,
  input: SelectedTurnAction,
): GameState {
  const next = cloneGameState(state);
  const player = requireSelectingPlayer(next, playerId, roundNumber);
  const card = player.deckState.hand.find(
    (candidate) => candidate.instanceId === input.cardInstanceId,
  );
  if (!card) throw new GameEngineError("CARD_NOT_IN_HAND");
  const definition = getCardDefinition(card.cardId);
  validateTarget(next, player, definition.targetType, input.targetPlayerId);
  validateAdditionalSelection(
    player,
    card.cardId,
    input.cardInstanceId,
    input.additionalSelection,
  );
  player.deckState.selectedAction = {
    cardInstanceId: input.cardInstanceId,
    ...(input.targetPlayerId ? { targetPlayerId: input.targetPlayerId } : {}),
    additionalSelection: input.additionalSelection ?? null,
  };
  return next;
}

export function clearAction(
  state: GameState,
  playerId: string,
  roundNumber: number,
): GameState {
  const next = cloneGameState(state);
  const player = requireSelectingPlayer(next, playerId, roundNumber);
  player.deckState.selectedAction = null;
  return next;
}

export function confirmAction(
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
    player.deckState.selectedAction = null;
    player.deckState.confirmed = true;
  }
  return next;
}

export function haveAllAlivePlayersConfirmed(state: GameState): boolean {
  return state.players
    .filter((player) => player.alive)
    .every((player) => player.deckState.confirmed);
}
