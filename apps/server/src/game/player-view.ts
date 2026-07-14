import {
  MAX_HP,
  type PlayerGameView,
  type RoomPhase,
} from "@blind-turn/shared";
import type { RoomState } from "../rooms/room-state";

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
    phase: room.phase as RoomPhase,
    players: room.players.map((session) => {
      const player = state?.players.find((candidate) => candidate.id === session.playerId);
      return {
        playerId: session.playerId,
        nickname: session.nickname,
        seatNumber: session.seatNumber,
        connected: session.connected,
        ready: session.ready,
        alive: player?.alive ?? true,
        hp: player?.hp ?? MAX_HP,
        submitted: room.game?.isSubmitted(session.playerId) ?? false,
      };
    }),
    turnNumber: state?.turnNumber ?? 0,
    mySpeed: gamePlayer?.speedRoll ?? null,
    mySubmittedAction: gamePlayer?.selectedAction
      ? { ...gamePlayer.selectedAction }
      : null,
    counterAvailable: gamePlayer?.previousTurnActionType !== "COUNTER",
    actionDeadlineAt:
      room.phase === "SELECTING_ACTION" ? room.actionDeadlineAt : null,
    result: state?.result ? { ...state.result } : null,
    totalTurns: state?.turnNumber ?? 0,
    fatalError: room.fatalError ? { ...room.fatalError } : null,
  };
}
