import {
  CHARACTER_CATALOG,
  MAX_HAND_SIZE,
  MAX_HP,
  getAllDeckCards,
  getCardDefinition,
  type PlayerGameView,
} from "@blind-turn/shared";
import type { RoomState } from "../rooms/room-state";

const privateCard = (card: { instanceId: string; cardId: string }) => ({
  ...card,
  definition: getCardDefinition(card.cardId),
});

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
    myQueuedCards: gamePlayer?.deckState.queuedCards.map((queued) => ({
      ...queued,
      additionalSelection: queued.additionalSelection
        ? JSON.parse(JSON.stringify(queued.additionalSelection)) as typeof queued.additionalSelection
        : null,
    })) ?? [],
    myConfirmed: gamePlayer?.deckState.confirmed ?? false,
    drawPileCount: gamePlayer?.deckState.drawPile.length ?? 0,
    discardPileCount: gamePlayer?.deckState.discardPile.length ?? 0,
    initialHandOptions:
      gamePlayer?.deckState.pendingInitialHandSelection.map(privateCard) ?? [],
    rewardOptions: gamePlayer?.deckState.pendingRewardOptions.map(getCardDefinition) ?? [],
    deckRemovalCandidates:
      gamePlayer?.deckState.pendingRemovalRequired
        ? getAllDeckCards(gamePlayer.deckState).map(privateCard)
        : [],
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
