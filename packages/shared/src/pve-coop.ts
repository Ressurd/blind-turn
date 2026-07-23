import type {
  PveBattleResult,
  PveBattleState,
  PveBossPlan,
  PveCharacterId,
  PveCombatEvent,
  PvePlannedAction,
  PvePlans,
  PveTurnResolution,
} from "@blind-turn/game-engine";
import type { ChatMessage, SessionCredentials, SocketError } from "./multiplayer";

export const PVE_COOP_MIN_PLAYERS = 2;
export const PVE_COOP_MAX_PLAYERS = 4;

export type PveRoomPhase = "LOBBY" | "PLANNING" | "RESOLVING" | "RESULT";

export type PveRoomPlayerView = {
  playerId: string;
  nickname: string;
  seatNumber: number;
  assignedCharacterIds: PveCharacterId[];
  connected: boolean;
  ready: boolean;
  confirmed: boolean;
  rematchRequested: boolean;
};

export type PveTurnPlayback = {
  turnNumber: number;
  startState: PveBattleState;
  resolution: PveTurnResolution;
};

export type PveTurnHistoryEntry = {
  turnNumber: number;
  plans: PvePlans;
  events: PveCombatEvent[];
  finalState: PveBattleState;
};

export type PveCoopRoomView = {
  mode: "PVE_COOP";
  roomCode: string;
  hostPlayerId: string;
  selfPlayerId: string;
  phase: PveRoomPhase;
  turnNumber: number;
  players: PveRoomPlayerView[];
  myAssignedCharacterIds: PveCharacterId[];
  battleState: PveBattleState;
  plans: PvePlans;
  confirmedPlayerIds: string[];
  bossPlan: PveBossPlan;
  pendingPlayback: PveTurnPlayback | null;
  result: PveBattleResult;
  latestEventId: string | null;
  history: PveTurnHistoryEntry[];
  chatHistory: ChatMessage[];
  fatalError: SocketError | null;
};

export type PveRoomIdentityResult = {
  credentials: SessionCredentials;
  view: PveCoopRoomView;
};

export type PveSetPlanSlotInput = {
  roomCode: string;
  turnNumber: number;
  characterId: PveCharacterId;
  beat: 1 | 2 | 3;
  action: PvePlannedAction | null;
};

export type PveTurnResolvedPayload = PveTurnPlayback;
