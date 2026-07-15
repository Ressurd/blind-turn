import type {
  ActionCardInstance,
  BattleEvent,
  CardDefinition,
  CharacterClassId,
  GameResult,
  SelectedTurnAction,
} from "@blind-turn/game-engine";
import {
  ACTION_TIMEOUT_MS,
  DECK_TRIM_TIMEOUT_MS,
  MAX_HAND_SIZE,
  REWARD_SELECTION_COUNT,
  REWARD_TIMEOUT_MS,
} from "@blind-turn/game-engine";

export const ROOM_CODE_LENGTH = 6;
export const MAX_ROOM_PLAYERS = 6;
export const MIN_GAME_PLAYERS = 2;
export {
  ACTION_TIMEOUT_MS,
  DECK_TRIM_TIMEOUT_MS,
  REWARD_SELECTION_COUNT,
  REWARD_TIMEOUT_MS,
};
export const EVENTS_FINISH_TIMEOUT_MS = 45_000;
export const DISCONNECT_GRACE_MS = 30_000;
export const ABANDONED_ROOM_TTL_MS = 10 * 60_000;
export const CHAT_MESSAGE_MAX_LENGTH = 100;
export const CHAT_HISTORY_LIMIT = 50;
export const CHAT_RATE_WINDOW_MS = 1_000;
export const CHAT_RATE_MAX_MESSAGES = 2;

export type RoomPhase =
  | "LOBBY"
  | "ROUND_STARTING"
  | "SELECTING_CARDS"
  | "RESOLVING_ROUND"
  | "SELECTING_REWARD"
  | "SELECTING_DECK_REMOVAL"
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
  | "CHARACTER_NOT_SELECTED"
  | "PLAYER_NOT_FOUND"
  | "INVALID_RECONNECT_TOKEN"
  | "SOCKET_NOT_OWNER"
  | "INVALID_GAME_PHASE"
  | "PLAYER_DEAD"
  | "CARD_NOT_IN_HAND"
  | "INVALID_CARD_TARGET"
  | "INVALID_ADDITIONAL_SELECTION"
  | "ROUND_ALREADY_CONFIRMED"
  | "ROUND_NUMBER_MISMATCH"
  | "REWARD_OPTION_NOT_FOUND"
  | "INVALID_REWARD_SELECTION"
  | "INVALID_DECK_REMOVAL"
  | "ATTACK_CARD_REQUIRED"
  | "CHAT_EMPTY"
  | "CHAT_MESSAGE_TOO_LONG"
  | "CHAT_RATE_LIMITED"
  | "CHAT_DEAD_PLAYER"
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

export type ChatMessage = {
  id: string;
  roomCode: string;
  playerId: string | null;
  nickname: string | null;
  message: string;
  createdAt: number;
  kind: "PLAYER" | "SYSTEM";
};

export type RoomPlayerView = {
  playerId: string;
  nickname: string;
  seatNumber: number;
  characterId: CharacterClassId | null;
  connected: boolean;
  ready: boolean;
  alive: boolean;
  hp: number;
  maxHp: number;
  handCount: number;
  maxHandSize: number;
  drawPileCount: number;
  discardPileCount: number;
  totalDeckCount: number;
  permanentlyRemovedCount: number;
  submitted: boolean;
  usedCardCount: number | null;
};

export type PrivateCardView = ActionCardInstance & {
  definition: CardDefinition;
};

export type PrivateDeckCardSummary = {
  cardId: string;
  definition: CardDefinition;
  totalCount: number;
  handCount: number;
  drawPileCount: number;
  discardPileCount: number;
  selectedCount: number;
  removedCount: number;
};

export type DeckRemovalCardView = PrivateCardView & {
  location: "HAND" | "DRAW_PILE" | "DISCARD_PILE";
  newlyAdded: boolean;
  removable: boolean;
};

export type RewardSelectionStatus = {
  selectedPlayerCount: number;
  totalPlayerCount: number;
};

export type RewardCardOption = CardDefinition;

export type RewardSelectionState = {
  roundNumber: number;
  options: RewardCardOption[];
  selectedCardIds: string[];
  requiredSelectionCount: 2;
  deadlineAt: number;
};

export type PlayerGameView = {
  roomCode: string;
  hostPlayerId: string;
  selfPlayerId: string;
  phase: RoomPhase;
  players: RoomPlayerView[];
  roundNumber: number;
  myCharacterId: CharacterClassId | null;
  myHand: PrivateCardView[];
  myDiscardPile: PrivateCardView[];
  myPermanentlyRemovedCards: PrivateCardView[];
  myDrawPileSummary: PrivateDeckCardSummary[];
  myDeckSummary: PrivateDeckCardSummary[];
  mySelectedAction: SelectedTurnAction | null;
  myConfirmed: boolean;
  drawPileCount: number;
  discardPileCount: number;
  totalDeckCount: number;
  permanentlyRemovedCount: number;
  maxDeckSize: number;
  rewardOptions: CardDefinition[];
  rewardSelectionState: RewardSelectionState | null;
  selectedRewards: CardDefinition[];
  rewardSelectionConfirmed: boolean;
  requiredRewardSelectionCount: number;
  rewardSelectionStatus: RewardSelectionStatus | null;
  deckRemovalCards: DeckRemovalCardView[];
  requiredRemovalCount: number;
  selectedRemovalInstanceIds: string[];
  deckRemovalConfirmed: boolean;
  actionDeadlineAt: number | null;
  rewardDeadlineAt: number | null;
  result: GameResult | null;
  totalRounds: number;
  fatalError: SocketError | null;
  chatHistory: ChatMessage[];
  pendingRoundPlayback: RoundResolvedPayload | null;
};

export type PublicBattleEvent = BattleEvent;

export type PublicGameSnapshot = {
  roundNumber: number;
  players: Array<{
    playerId: string;
    hp: number;
    maxHp: number;
    alive: boolean;
    handCount: number;
    drawPileCount: number;
    discardPileCount: number;
    totalDeckCount: number;
    permanentlyRemovedCount: number;
  }>;
  result: GameResult | null;
};

export type RoundResolvedPayload = {
  roundNumber: number;
  events: PublicBattleEvent[];
  publicState: PublicGameSnapshot;
};

export type RoundSubmissionStatusPayload = {
  roundNumber: number;
  confirmedPlayerIds: string[];
};

export type CardCountsRevealedPayload = {
  roundNumber: number;
  cardCounts: Array<{ playerId: string; count: number }>;
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
  "room:select-character": (
    payload: { roomCode: string; characterId: CharacterClassId },
    ack: SocketAckCallback<{ characterId: CharacterClassId }>,
  ) => void;
  "room:set-ready": (
    payload: { roomCode: string; ready: boolean },
    ack: SocketAckCallback<{ ready: boolean }>,
  ) => void;
  "room:start-game": (
    payload: { roomCode: string },
    ack: SocketAckCallback<{ started: true }>,
  ) => void;
  "game:select-action": (
    payload: {
      roomCode: string;
      roundNumber: number;
      cardInstanceId: string;
      targetPlayerId?: string;
      additionalSelection?: SelectedTurnAction["additionalSelection"];
    },
    ack: SocketAckCallback<{ accepted: true }>,
  ) => void;
  "game:clear-action": (
    payload: { roomCode: string; roundNumber: number },
    ack: SocketAckCallback<{ accepted: true }>,
  ) => void;
  "game:confirm-action": (
    payload: { roomCode: string; roundNumber: number },
    ack: SocketAckCallback<{ accepted: true }>,
  ) => void;
  "game:events-finished": (
    payload: { roomCode: string; roundNumber: number },
    ack: SocketAckCallback<{ accepted: true }>,
  ) => void;
  "game:update-reward-selection": (
    payload: { roomCode: string; selectedCardIds: string[] },
    ack: SocketAckCallback<{ accepted: true }>,
  ) => void;
  "game:confirm-reward": (
    payload: { roomCode: string },
    ack: SocketAckCallback<{ accepted: true }>,
  ) => void;
  "game:update-deck-removal": (
    payload: { roomCode: string; selectedInstanceIds: string[] },
    ack: SocketAckCallback<{ accepted: true }>,
  ) => void;
  "game:confirm-deck-removal": (
    payload: { roomCode: string },
    ack: SocketAckCallback<{ accepted: true }>,
  ) => void;
  "game:request-rematch": (
    payload: { roomCode: string },
    ack: SocketAckCallback<{ reset: true }>,
  ) => void;
  "chat:send": (
    payload: { roomCode: string; message: string },
    ack: SocketAckCallback<{ sent: true }>,
  ) => void;
}

export interface ServerToClientEvents {
  "room:created": (payload: CreateRoomResult) => void;
  "room:joined": (payload: JoinRoomResult) => void;
  "room:state-updated": (payload: PlayerGameView) => void;
  "room:character-selected": (payload: {
    playerId: string;
    characterId: CharacterClassId;
  }) => void;
  "room:error": (payload: SocketError) => void;
  "room:player-disconnected": (payload: { playerId: string }) => void;
  "room:player-reconnected": (payload: { playerId: string }) => void;
  "game:started": (payload: { roundNumber: number }) => void;
  "game:action-updated": (payload: { selectedAction: SelectedTurnAction | null }) => void;
  "game:round-submission-status": (payload: RoundSubmissionStatusPayload) => void;
  "game:round-locked": (payload: { roundNumber: number }) => void;
  "game:card-counts-revealed": (payload: CardCountsRevealedPayload) => void;
  "game:round-resolving": (payload: { roundNumber: number }) => void;
  "game:round-resolved": (payload: RoundResolvedPayload) => void;
  "game:next-round": (payload: {
    roundNumber: number;
    actionDeadlineAt: number;
  }) => void;
  "game:reward-options": (payload: { cards: CardDefinition[]; deadlineAt: number }) => void;
  "game:reward-selected": (payload: { playerId: string }) => void;
  "game:deck-removal-required": (payload: { cards: DeckRemovalCardView[]; deadlineAt: number }) => void;
  "game:deck-updated": (payload: { deckSize: number }) => void;
  "game:finished": (payload: { result: GameResult; totalRounds: number }) => void;
  "game:error": (payload: SocketError) => void;
  "chat:message": (payload: ChatMessage) => void;
  "chat:history": (payload: { messages: ChatMessage[] }) => void;
  "chat:error": (payload: SocketError) => void;
}

export type SocketData = {
  roomCode?: string;
  playerId?: string;
};

export const PUBLIC_MAX_HAND_SIZE = MAX_HAND_SIZE;
