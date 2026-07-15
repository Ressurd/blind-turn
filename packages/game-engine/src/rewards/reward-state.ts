import {
  MAX_COPIES_PER_CARD_ID,
  MAX_TOTAL_DECK_SIZE,
  REWARD_SELECTION_COUNT,
} from "../constants";
import {
  getCardDefinition,
  getRewardPool,
  isAttackCard,
} from "../cards/card-catalog";
import {
  countCardCopies,
  getAllDeckCards,
  getDeckSize,
  insertNewCards,
  removeCardInstance,
} from "../deck/deck-state";
import type { RandomSource } from "../random";
import { cloneGameState } from "../state/game-state";
import type { GameState, PlayerState } from "../types";
import { GameEngineError } from "../round/round-actions";

function eligibleCards(player: PlayerState, cardIds: readonly string[]): string[] {
  return cardIds.filter(
    (cardId) => countCardCopies(player.deckState, cardId) < MAX_COPIES_PER_CARD_ID,
  );
}

function findAlivePlayer(state: GameState, playerId: string): PlayerState {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player?.alive) throw new GameEngineError("PLAYER_DEAD");
  return player;
}

function clearCompletedRewardCycle(state: GameState): void {
  for (const player of state.players) {
    player.deckState.newlyAddedCardInstanceIds = [];
    player.deckState.selectedRemovalInstanceIds = [];
    player.deckState.requiredRemovalCount = 0;
    player.deckState.deckRemovalConfirmed = false;
  }
}

export function prepareRewardOptions(
  state: GameState,
  randomSource: RandomSource,
): GameState {
  const next = cloneGameState(state);
  next.phase = "SELECTING_REWARD";
  for (const player of next.players.filter((candidate) => candidate.alive)) {
    const pool = getRewardPool(player.characterId);
    const classIds = eligibleCards(
      player,
      pool.classCards.map((card) => card.id),
    );
    const commonIds = eligibleCards(
      player,
      pool.commonCards.map((card) => card.id),
    );
    if (classIds.length < 2 || commonIds.length < 1) {
      throw new Error(`Not enough reward cards for ${player.id}`);
    }
    player.deckState.pendingRewardOptions = [
      ...randomSource.shuffle(classIds).slice(0, 2),
      ...randomSource.shuffle(commonIds).slice(0, 1),
    ];
    player.deckState.selectedRewardCardIds = [];
    player.deckState.rewardConfirmed = false;
    player.deckState.requiredRemovalCount = 0;
    player.deckState.selectedRemovalInstanceIds = [];
    player.deckState.newlyAddedCardInstanceIds = [];
    player.deckState.deckRemovalConfirmed = false;
  }
  return next;
}

export function updateRewardSelection(
  state: GameState,
  playerId: string,
  cardIds: readonly string[],
): GameState {
  if (state.phase !== "SELECTING_REWARD") {
    throw new GameEngineError("INVALID_GAME_PHASE");
  }
  const next = cloneGameState(state);
  const player = findAlivePlayer(next, playerId);
  if (player.deckState.rewardConfirmed) {
    throw new GameEngineError("INVALID_REWARD_SELECTION");
  }
  const uniqueIds = [...new Set(cardIds)];
  if (
    uniqueIds.length !== cardIds.length
    || uniqueIds.length > REWARD_SELECTION_COUNT
    || uniqueIds.some((cardId) =>
      !player.deckState.pendingRewardOptions.includes(cardId)
      || countCardCopies(player.deckState, cardId) >= MAX_COPIES_PER_CARD_ID
    )
  ) {
    throw new GameEngineError("INVALID_REWARD_SELECTION");
  }
  player.deckState.selectedRewardCardIds = uniqueIds;
  return next;
}

function allRewardsConfirmed(state: GameState): boolean {
  return state.players
    .filter((player) => player.alive)
    .every((player) => player.deckState.rewardConfirmed);
}

export function confirmRewardSelection(
  state: GameState,
  playerId: string,
  randomSource: RandomSource,
): GameState {
  if (state.phase !== "SELECTING_REWARD") {
    throw new GameEngineError("INVALID_GAME_PHASE");
  }
  const next = cloneGameState(state);
  const player = findAlivePlayer(next, playerId);
  if (
    player.deckState.rewardConfirmed
    || player.deckState.selectedRewardCardIds.length !== REWARD_SELECTION_COUNT
  ) {
    throw new GameEngineError("INVALID_REWARD_SELECTION");
  }
  const selectedIds = [...player.deckState.selectedRewardCardIds];
  if (selectedIds.some((cardId) =>
    !player.deckState.pendingRewardOptions.includes(cardId)
    || countCardCopies(player.deckState, cardId) >= MAX_COPIES_PER_CARD_ID
  )) {
    throw new GameEngineError("INVALID_REWARD_SELECTION");
  }
  const inserted = insertNewCards(
    player.deckState,
    player.id,
    selectedIds,
    randomSource,
  );
  player.deckState = inserted.state;
  player.deckState.newlyAddedCardInstanceIds = inserted.inserted.map(
    (card) => card.instanceId,
  );
  player.deckState.requiredRemovalCount = Math.max(
    0,
    getDeckSize(player.deckState) - MAX_TOTAL_DECK_SIZE,
  );
  player.deckState.deckRemovalConfirmed =
    player.deckState.requiredRemovalCount === 0;
  player.deckState.rewardConfirmed = true;
  player.deckState.pendingRewardOptions = [];

  if (allRewardsConfirmed(next)) {
    const needsRemoval = next.players.some(
      (candidate) =>
        candidate.alive && candidate.deckState.requiredRemovalCount > 0,
    );
    next.phase = needsRemoval ? "SELECTING_DECK_REMOVAL" : "ROUND_STARTING";
    if (!needsRemoval) clearCompletedRewardCycle(next);
  }
  return next;
}

export function selectRandomPendingRewards(
  state: GameState,
  randomSource: RandomSource,
): GameState {
  let next = state;
  for (const playerId of state.players
    .filter((candidate) => candidate.alive && !candidate.deckState.rewardConfirmed)
    .map((candidate) => candidate.id)) {
    const player = next.players.find((candidate) => candidate.id === playerId)!;
    const selected = randomSource
      .shuffle(player.deckState.pendingRewardOptions)
      .slice(0, REWARD_SELECTION_COUNT);
    next = updateRewardSelection(next, playerId, selected);
    next = confirmRewardSelection(next, playerId, randomSource);
  }
  return next;
}

export function getDeckRemovalCandidates(player: PlayerState) {
  const newIds = new Set(player.deckState.newlyAddedCardInstanceIds);
  return getAllDeckCards(player.deckState).filter(
    (card) => !newIds.has(card.instanceId),
  );
}

export function updateDeckRemovalSelection(
  state: GameState,
  playerId: string,
  instanceIds: readonly string[],
): GameState {
  if (state.phase !== "SELECTING_DECK_REMOVAL") {
    throw new GameEngineError("INVALID_GAME_PHASE");
  }
  const next = cloneGameState(state);
  const player = findAlivePlayer(next, playerId);
  if (player.deckState.deckRemovalConfirmed) {
    throw new GameEngineError("INVALID_DECK_REMOVAL");
  }
  const uniqueIds = [...new Set(instanceIds)];
  const candidates = new Set(
    getDeckRemovalCandidates(player).map((card) => card.instanceId),
  );
  if (
    uniqueIds.length !== instanceIds.length
    || uniqueIds.length > player.deckState.requiredRemovalCount
    || uniqueIds.some((instanceId) => !candidates.has(instanceId))
  ) {
    throw new GameEngineError("INVALID_DECK_REMOVAL");
  }
  player.deckState.selectedRemovalInstanceIds = uniqueIds;
  return next;
}

function allDeckRemovalsConfirmed(state: GameState): boolean {
  return state.players
    .filter((player) => player.alive)
    .every((player) =>
      player.deckState.requiredRemovalCount === 0
      || player.deckState.deckRemovalConfirmed
    );
}

export function confirmDeckRemoval(
  state: GameState,
  playerId: string,
): GameState {
  if (state.phase !== "SELECTING_DECK_REMOVAL") {
    throw new GameEngineError("INVALID_GAME_PHASE");
  }
  const next = cloneGameState(state);
  const player = findAlivePlayer(next, playerId);
  const selectedIds = [...player.deckState.selectedRemovalInstanceIds];
  if (
    player.deckState.deckRemovalConfirmed
    || player.deckState.requiredRemovalCount <= 0
    || selectedIds.length !== player.deckState.requiredRemovalCount
  ) {
    throw new GameEngineError("INVALID_DECK_REMOVAL");
  }
  const selected = new Set(selectedIds);
  const attackCountAfterRemoval = getAllDeckCards(player.deckState).filter(
    (card) => !selected.has(card.instanceId) && isAttackCard(card.cardId),
  ).length;
  if (attackCountAfterRemoval < 1) {
    throw new GameEngineError("ATTACK_CARD_REQUIRED");
  }
  for (const instanceId of selectedIds) {
    const removal = removeCardInstance(player.deckState, instanceId);
    if (!removal.removed) throw new GameEngineError("INVALID_DECK_REMOVAL");
    removal.state.permanentlyRemovedCards.push(removal.removed);
    player.deckState = removal.state;
  }
  player.deckState.deckRemovalConfirmed = true;
  if (allDeckRemovalsConfirmed(next)) {
    next.phase = "ROUND_STARTING";
    clearCompletedRewardCycle(next);
  }
  return next;
}

export function chooseAutomaticDeckRemovals(player: PlayerState): string[] {
  const required = player.deckState.requiredRemovalCount;
  const cards = getDeckRemovalCandidates(player).sort((left, right) => {
    const leftBase = getCardDefinition(left.cardId).classId === "BASE" ? 0 : 1;
    const rightBase = getCardDefinition(right.cardId).classId === "BASE" ? 0 : 1;
    if (leftBase !== rightBase) return leftBase - rightBase;
    return Number(isAttackCard(left.cardId)) - Number(isAttackCard(right.cardId));
  });
  const attackCount = getAllDeckCards(player.deckState).filter((card) =>
    isAttackCard(card.cardId)
  ).length;
  let removedAttacks = 0;
  const selected: string[] = [];
  for (const card of cards) {
    if (selected.length >= required) break;
    if (isAttackCard(card.cardId) && attackCount - removedAttacks <= 1) continue;
    selected.push(card.instanceId);
    if (isAttackCard(card.cardId)) removedAttacks += 1;
  }
  if (selected.length !== required) {
    throw new GameEngineError("ATTACK_CARD_REQUIRED");
  }
  return selected;
}
