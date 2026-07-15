import {
  MAX_COPIES_PER_CARD_ID,
  MAX_DECK_SIZE,
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
  insertNewCard,
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
    player.deckState.pendingRewardCardId = null;
    player.deckState.pendingRemovalRequired = false;
  }
  return next;
}

function allRewardsSelected(state: GameState): boolean {
  return state.players
    .filter((player) => player.alive)
    .every((player) => player.deckState.pendingRewardOptions.length === 0);
}

export function selectReward(
  state: GameState,
  playerId: string,
  cardId: string,
  randomSource: RandomSource,
): GameState {
  if (state.phase !== "SELECTING_REWARD") {
    throw new GameEngineError("INVALID_GAME_PHASE");
  }
  const next = cloneGameState(state);
  const player = next.players.find((candidate) => candidate.id === playerId);
  if (!player || !player.alive) throw new GameEngineError("PLAYER_DEAD");
  if (!player.deckState.pendingRewardOptions.includes(cardId)) {
    throw new GameEngineError("REWARD_OPTION_NOT_FOUND");
  }
  if (countCardCopies(player.deckState, cardId) >= MAX_COPIES_PER_CARD_ID) {
    throw new GameEngineError("REWARD_OPTION_NOT_FOUND");
  }
  player.deckState.pendingRewardOptions = [];
  if (getDeckSize(player.deckState) < MAX_DECK_SIZE) {
    player.deckState = insertNewCard(
      player.deckState,
      player.id,
      cardId,
      randomSource,
    );
  } else {
    player.deckState.pendingRewardCardId = cardId;
    player.deckState.pendingRemovalRequired = true;
  }
  if (allRewardsSelected(next)) {
    next.phase = next.players.some(
      (candidate) => candidate.alive && candidate.deckState.pendingRemovalRequired,
    )
      ? "SELECTING_DECK_REMOVAL"
      : "ROUND_STARTING";
  }
  return next;
}

export function selectRandomPendingRewards(
  state: GameState,
  randomSource: RandomSource,
): GameState {
  let next = state;
  for (const player of state.players.filter((candidate) =>
    candidate.alive && candidate.deckState.pendingRewardOptions.length > 0
  )) {
    const options = player.deckState.pendingRewardOptions;
    const index = randomSource.nextInt(0, options.length - 1, "REWARD");
    next = selectReward(next, player.id, options[index]!, randomSource);
  }
  return next;
}

export function getDeckRemovalCandidates(player: PlayerState) {
  return getAllDeckCards(player.deckState);
}

export function selectDeckRemoval(
  state: GameState,
  playerId: string,
  instanceId: string,
  randomSource: RandomSource,
): GameState {
  if (state.phase !== "SELECTING_DECK_REMOVAL") {
    throw new GameEngineError("INVALID_GAME_PHASE");
  }
  const next = cloneGameState(state);
  const player = next.players.find((candidate) => candidate.id === playerId);
  if (!player || !player.alive) throw new GameEngineError("PLAYER_DEAD");
  const rewardCardId = player.deckState.pendingRewardCardId;
  if (!rewardCardId || !player.deckState.pendingRemovalRequired) {
    throw new GameEngineError("INVALID_DECK_REMOVAL");
  }
  const removal = getAllDeckCards(player.deckState).find(
    (card) => card.instanceId === instanceId,
  );
  if (!removal) throw new GameEngineError("INVALID_DECK_REMOVAL");
  const attackCountAfterRemoval = getAllDeckCards(player.deckState).filter(
    (card) => card.instanceId !== instanceId && isAttackCard(card.cardId),
  ).length + (isAttackCard(rewardCardId) ? 1 : 0);
  if (attackCountAfterRemoval < 1) {
    throw new GameEngineError("ATTACK_CARD_REQUIRED");
  }
  const removed = removeCardInstance(player.deckState, instanceId);
  if (!removed.removed) throw new GameEngineError("INVALID_DECK_REMOVAL");
  player.deckState = insertNewCard(
    removed.state,
    player.id,
    rewardCardId,
    randomSource,
  );
  player.deckState.pendingRewardCardId = null;
  player.deckState.pendingRemovalRequired = false;
  if (next.players
    .filter((candidate) => candidate.alive)
    .every((candidate) => !candidate.deckState.pendingRemovalRequired)) {
    next.phase = "ROUND_STARTING";
  }
  return next;
}

export function chooseAutomaticDeckRemoval(player: PlayerState): string {
  const cards = getAllDeckCards(player.deckState);
  const attackCards = cards.filter((card) => isAttackCard(card.cardId));
  const removable = cards.filter(
    (card) => attackCards.length > 1 || !isAttackCard(card.cardId),
  );
  const preferred = removable.find(
    (card) => getCardDefinition(card.cardId).classId === "BASE",
  );
  const candidate = preferred ?? removable[0];
  if (!candidate) throw new GameEngineError("ATTACK_CARD_REQUIRED");
  return candidate.instanceId;
}
