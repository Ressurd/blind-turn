import type { RoomPhase, SocketError } from "@blind-turn/shared";
import type { GameSession } from "../game/game-session";

export type PlayerSession = {
  playerId: string;
  reconnectToken: string;
  socketId: string | null;
  nickname: string;
  seatNumber: number;
  connected: boolean;
  ready: boolean;
};

export type RoomTimers = {
  action: ReturnType<typeof setTimeout> | null;
  nextTurn: ReturnType<typeof setTimeout> | null;
  cleanup: ReturnType<typeof setTimeout> | null;
  disconnects: Map<string, ReturnType<typeof setTimeout>>;
};

export type RoomState = {
  roomCode: string;
  hostPlayerId: string;
  phase: RoomPhase;
  players: PlayerSession[];
  game: GameSession | null;
  actionDeadlineAt: number | null;
  fatalError: SocketError | null;
  createdAt: number;
  updatedAt: number;
  timers: RoomTimers;
};
