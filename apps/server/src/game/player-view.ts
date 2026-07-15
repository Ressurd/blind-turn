import {
  CHARACTER_CATALOG,
  MAX_TOTAL_DECK_SIZE,
  MAX_HAND_SIZE,
  MAX_HP,
  REWARD_SELECTION_COUNT,
  getAllDeckCards,
  getCardDefinition,
  type PlayerGameView,
  type PlayerDeckState,
  type PrivateDeckCardSummary,
} from "@blind-turn/shared";
import type { RoomState } from "../rooms/room-state";

const privateCard = (card: { instanceId: string; cardId: string }) => ({
  ...card,
  definition: getCardDefinition(card.cardId),
});

function summarizeDeck(state: PlayerDeckState): PrivateDeckCardSummary[] {
  const queuedIds = new Set(
    state.queuedCards.map((queued) => queued.cardInstanceId),
  );
  const summaries = new Map<string, PrivateDeckCardSummary>();
  const add = (
    card: { cardId: string; instanceId: string },
    location:
      | "handCount"
      | "drawPileCount"
      | "discardPileCount"
      | "removedCount",
  ) => {
    const current = summaries.get(card.cardId) ?? {
      cardId: card.cardId,
      definition: getCardDefinition(card.cardId),
      totalCount: 0,
      handCount: 0,
      drawPileCount: 0,
      discardPileCount: 0,
      queuedCount: 0,
      removedCount: 0,
    };
    if (location !== "removedCount") current.totalCount += 1;
    if (location === "handCount" && queuedIds.has(card.instanceId)) {
      current.queuedCount += 1;
    } else {
      current[location] += 1;
    }
    summaries.set(card.cardId, current);
  };
  state.hand.forEach((card) => add(card, "handCount"));
  state.drawPile.forEach((card) => add(card, "drawPileCount"));
  state.discardPile.forEach((card) => add(card, "discardPileCount"));
  state.permanentlyRemovedCards.forEach((card) => add(card, "removedCount"));
  return [...summaries.values()].sort((left, right) =>
    left.definition.name.localeCompare(right.definition.name, "ko")
  );
}

export function createPlayerView(
  room: RoomState,
  viewerPlayerId: string,
): PlayerGameView {
  const viewer = room.players.find((player) => player.playerId === viewerPlayerId);
  if (!viewer) throw new Error(`Unknown viewer ${viewerPlayerId}`);
  const state = room.game?.getState() ?? null;
  const gamePlayer = state?.players.find((player) => player.id === viewerPlayerId);

  return {
    roomCode: room.roomCode,
    hostPlayerId: room.hostPlayerId,
    selfPlayerId: viewerPlayerId,
    phase: room.phase,
    players: room.players.map((session) => {
      const player = state?.players.find((candidate) => candidate.id === session.playerId);
      const characterMaxHp = session.characterId
        ? CHARACTER_CATALOG[session.characterId].maxHp
        : MAX_HP;
      return {
        playerId: session.playerId,
        nickname: session.nickname,
        seatNumber: session.seatNumber,
        characterId: session.characterId,
        connected: session.connected,
        ready: session.ready,
        alive: player?.alive ?? true,
        hp: player?.hp ?? characterMaxHp,
        maxHp: player?.maxHp ?? characterMaxHp,
        handCount: player?.deckState.hand.length ?? 0,
        maxHandSize: MAX_HAND_SIZE,
        drawPileCount: player?.deckState.drawPile.length ?? 0,
        discardPileCount: player?.deckState.discardPile.length ?? 0,
        totalDeckCount: player ? getAllDeckCards(player.deckState).length : 0,
        permanentlyRemovedCount:
          player?.deckState.permanentlyRemovedCards.length ?? 0,
        submitted: player?.deckState.confirmed ?? false,
        usedCardCount: room.phase === "SELECTING_CARDS"
          ? null
          : room.lockedCardCounts.get(session.playerId) ?? null,
      };
    }),
    roundNumber: state?.roundNumber ?? 0,
    myCharacterId: viewer.characterId,
    myHand: gamePlayer?.deckState.hand.map(privateCard) ?? [],
    myDiscardPile: gamePlayer?.deckState.discardPile.map(privateCard) ?? [],
    myPermanentlyRemovedCards:
      gamePlayer?.deckState.permanentlyRemovedCards.map(privateCard) ?? [],
    myDrawPileSummary: gamePlayer
      ? summarizeDeck(gamePlayer.deckState).filter((summary) => summary.drawPileCount > 0)
      : [],
    myDeckSummary: gamePlayer ? summarizeDeck(gamePlayer.deckState) : [],
    myQueuedCards: gamePlayer?.deckState.queuedCards.map((queued) => ({
      ...queued,
      additionalSelection: queued.additionalSelection
        ? JSON.parse(JSON.stringify(queued.additionalSelection)) as typeof queued.additionalSelection
        : null,
    })) ?? [],
    myConfirmed: gamePlayer?.deckState.confirmed ?? false,
    drawPileCount: gamePlayer?.deckState.drawPile.length ?? 0,
    discardPileCount: gamePlayer?.deckState.discardPile.length ?? 0,
    totalDeckCount: gamePlayer ? getAllDeckCards(gamePlayer.deckState).length : 0,
    permanentlyRemovedCount:
      gamePlayer?.deckState.permanentlyRemovedCards.length ?? 0,
    maxDeckSize: MAX_TOTAL_DECK_SIZE,
    initialHandOptions:
      gamePlayer?.deckState.pendingInitialHandSelection.map(privateCard) ?? [],
    rewardOptions: gamePlayer?.deckState.pendingRewardOptions.map(getCardDefinition) ?? [],
    selectedRewards:
      gamePlayer?.deckState.selectedRewardCardIds.map(getCardDefinition) ?? [],
    rewardSelectionConfirmed:
      gamePlayer?.deckState.rewardConfirmed ?? false,
    requiredRewardSelectionCount: REWARD_SELECTION_COUNT,
    rewardSelectionStatus:
      state && (room.phase === "SELECTING_REWARD" || room.phase === "SELECTING_DECK_REMOVAL")
        ? {
            selectedPlayerCount: state.players.filter(
              (player) => player.alive && player.deckState.rewardConfirmed,
            ).length,
            totalPlayerCount: state.players.filter((player) => player.alive).length,
          }
        : null,
    deckRemovalCards: gamePlayer?.deckState.requiredRemovalCount
      ? ([
          ...gamePlayer.deckState.hand.map((card) => ({ card, location: "HAND" as const })),
          ...gamePlayer.deckState.drawPile.map((card) => ({ card, location: "DRAW_PILE" as const })),
          ...gamePlayer.deckState.discardPile.map((card) => ({ card, location: "DISCARD_PILE" as const })),
        ]).map(({ card, location }) => {
          const newlyAdded = gamePlayer.deckState.newlyAddedCardInstanceIds.includes(
            card.instanceId,
          );
          return {
            ...privateCard(card),
            location,
            newlyAdded,
            removable: !newlyAdded,
          };
        })
      : [],
    requiredRemovalCount: gamePlayer?.deckState.requiredRemovalCount ?? 0,
    selectedRemovalInstanceIds:
      gamePlayer?.deckState.selectedRemovalInstanceIds ?? [],
    deckRemovalConfirmed:
      gamePlayer?.deckState.deckRemovalConfirmed ?? false,
    actionDeadlineAt:
      room.phase === "SELECTING_CARDS" ? room.actionDeadlineAt : null,
    rewardDeadlineAt:
      room.phase === "SELECTING_REWARD"
      || room.phase === "SELECTING_DECK_REMOVAL"
        ? room.rewardDeadlineAt
        : null,
    result: state?.result ? { ...state.result } : null,
    totalRounds: state?.roundNumber ?? 0,
    fatalError: room.fatalError ? { ...room.fatalError } : null,
    chatHistory: room.chatMessages.map((message) => ({ ...message })),
    pendingRoundPlayback:
      room.phase === "RESOLVING_ROUND"
        ? room.game?.getLastResolvedPayload() ?? null
        : null,
  };
}
