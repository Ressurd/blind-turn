import type {
  BattleEvent,
  GameResult,
  PlayerAction,
} from "@blind-turn/game-engine";

export const ROOM_CODE_LENGTH = 6;
export const MAX_ROOM_PLAYERS = 6;
export const MIN_GAME_PLAYERS = 2;
export const ACTION_TIMEOUT_MS = 30_000;
export const EVENTS_FINISH_TIMEOUT_MS = 8_000;
export const DISCONNECT_GRACE_MS = 30_000;
export const ABANDONED_ROOM_TTL_MS = 10 * 60_000;

export type RoomPhase =
  | "LOBBY"
  | "ROLLING_SPEED"
  | "SELECTING_ACTION"
  | "RESOLVING"
  | "FINISHED";

export type RoomErrorCode =
  | "ROOM_NOT_FOUND"
  | "ROOM_SESSION_EXPIRED"
  | "ROOM_FULL"
  | "ROOM_CODE_GENERATION_FAILED"
  | "GAME_ALREADY_STARTED"
  | "NICKNAME_ALREADY_USED"
  | "INVALID_NICKNAME"
  | "INVALID_PAYLOAD"
  | "NOT_ROOM_HOST"
  | "NOT_ALL_PLAYERS_READY"
  | "NOT_ENOUGH_PLAYERS"
  | "PLAYER_NOT_FOUND"
  | "INVALID_RECONNECT_TOKEN"
  | "SOCKET_NOT_OWNER"
  | "INVALID_GAME_PHASE"
  | "PLAYER_DEAD"
  | "ACTION_ALREADY_SUBMITTED"
  | "INVALID_ACTION"
  | "INVALID_TARGET"
  | "TURN_NUMBER_MISMATCH"
  | "GAME_ENGINE_FAILURE"
  | "INTERNAL_SERVER_ERROR";

export type SocketError = {
  code: RoomErrorCode;
  message: string;
  recoverable: boolean;
};

export type SocketAck<T> =
  | { ok: true; data: T }
  | { ok: false; error: SocketError };

export type SessionCredentials = {
  roomCode: string;
  playerId: string;
  reconnectToken: string;
};

export type RoomPlayerView = {
  playerId: string;
  nickname: string;
  seatNumber: number;
  connected: boolean;
  ready: boolean;
  alive: boolean;
  hp: number;
  submitted: boolean;
};

export type PlayerGameView = {
  roomCode: string;
  hostPlayerId: string;
  selfPlayerId: string;
  phase: RoomPhase;
  players: RoomPlayerView[];
  turnNumber: number;
  mySpeed: number | null;
  mySubmittedAction: PlayerAction | null;
  counterAvailable: boolean;
  actionDeadlineAt: number | null;
  result: GameResult | null;
  totalTurns: number;
  fatalError: SocketError | null;
};

export type PublicBattleEvent = Exclude<
  BattleEvent,
  { type: "SPEED_ROLLED" }
>;

export type PublicGameSnapshot = {
  turnNumber: number;
  players: Array<{
    playerId: string;
    hp: number;
    alive: boolean;
  }>;
  result: GameResult | null;
};

export type TurnResolvedPayload = {
  turnNumber: number;
  events: PublicBattleEvent[];
  publicState: PublicGameSnapshot;
};

export type SubmissionStatusPayload = {
  turnNumber: number;
  submittedPlayerIds: string[];
};

export type CreateRoomResult = {
  credentials: SessionCredentials;
  view: PlayerGameView;
};

export type JoinRoomResult = CreateRoomResult;
export type ReconnectRoomResult = CreateRoomResult;

export type SocketAckCallback<T> = (response: SocketAck<T>) => void;

export interface ClientToServerEvents {
  "room:create": (
    payload: { nickname: string },
    ack: SocketAckCallback<CreateRoomResult>,
  ) => void;
  "room:join": (
    payload: { roomCode: string; nickname: string },
    ack: SocketAckCallback<JoinRoomResult>,
  ) => void;
  "room:reconnect": (
    payload: SessionCredentials,
    ack: SocketAckCallback<ReconnectRoomResult>,
  ) => void;
  "room:leave": (
    payload: { roomCode: string },
    ack: SocketAckCallback<{ left: true }>,
  ) => void;
  "room:set-ready": (
    payload: { roomCode: string; ready: boolean },
    ack: SocketAckCallback<{ ready: boolean }>,
  ) => void;
  "room:start-game": (
    payload: { roomCode: string },
    ack: SocketAckCallback<{ started: true }>,
  ) => void;
  "game:submit-action": (
    payload: {
      roomCode: string;
      turnNumber: number;
      action: PlayerAction;
    },
    ack: SocketAckCallback<{ accepted: true }>,
  ) => void;
  "game:events-finished": (
    payload: { roomCode: string; turnNumber: number },
    ack: SocketAckCallback<{ accepted: true }>,
  ) => void;
  "game:request-rematch": (
    payload: { roomCode: string },
    ack: SocketAckCallback<{ reset: true }>,
  ) => void;
}

export interface ServerToClientEvents {
  "room:created": (payload: CreateRoomResult) => void;
  "room:joined": (payload: JoinRoomResult) => void;
  "room:state-updated": (payload: PlayerGameView) => void;
  "room:error": (payload: SocketError) => void;
  "room:player-disconnected": (payload: { playerId: string }) => void;
  "room:player-reconnected": (payload: { playerId: string }) => void;
  "game:started": (payload: { turnNumber: number }) => void;
  "game:private-speed": (payload: {
    turnNumber: number;
    speed: number;
  }) => void;
  "game:action-accepted": (payload: { turnNumber: number }) => void;
  "game:submission-status": (payload: SubmissionStatusPayload) => void;
  "game:turn-resolving": (payload: { turnNumber: number }) => void;
  "game:turn-resolved": (payload: TurnResolvedPayload) => void;
  "game:next-turn": (payload: {
    turnNumber: number;
    actionDeadlineAt: number;
  }) => void;
  "game:finished": (payload: {
    result: GameResult;
    totalTurns: number;
  }) => void;
  "game:error": (payload: SocketError) => void;
}

export type SocketData = {
  roomCode?: string;
  playerId?: string;
};
