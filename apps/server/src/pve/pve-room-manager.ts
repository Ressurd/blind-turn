import { randomUUID } from "node:crypto";
import {
  CHAT_HISTORY_LIMIT,
  CHAT_MESSAGE_MAX_LENGTH,
  CHAT_RATE_MAX_MESSAGES,
  CHAT_RATE_WINDOW_MS,
  NicknameSchema,
  PVE_CHARACTER_ORDER,
  PVE_COOP_MAX_PLAYERS,
  PVE_COOP_MIN_PLAYERS,
  createEmptyPvePlans,
  createInitialPveBattleState,
  createPassPvePlans,
  createPveBossPlan,
  getPveTurnPlaybackTimeoutMs,
  isPvePlanComplete,
  resolvePveTurn,
  validatePvePlannedAction,
  type ChatMessage,
  type PveBattleState,
  type PveBossPlan,
  type PveCharacterId,
  type PveCoopRoomView,
  type PvePlans,
  type PveRoomIdentityResult,
  type PveRoomPhase,
  type PveTurnHistoryEntry,
  type PveTurnPlayback,
  type PveTurnResolution,
  type SessionCredentials,
  type SocketError,
} from "@blind-turn/shared";
import { maskPlayerId, maskRoomCode, noopLogger, type AppLogger } from "../logging/logger";
import { createRoomCode } from "../rooms/room-code";
import { RoomError } from "../rooms/room-error";

export type PvePlayerSession = {
  playerId: string;
  reconnectToken: string;
  socketId: string | null;
  nickname: string;
  seatNumber: number;
  assignedCharacterIds: PveCharacterId[];
  connected: boolean;
  ready: boolean;
};

export type PveRoomState = {
  roomCode: string;
  hostPlayerId: string;
  phase: PveRoomPhase;
  turnNumber: number;
  players: PvePlayerSession[];
  battleState: PveBattleState;
  plans: PvePlans;
  confirmedPlayerIds: Set<string>;
  bossPlan: PveBossPlan;
  pendingPlayback: PveTurnPlayback | null;
  playbackFinishedPlayerIds: Set<string>;
  history: PveTurnHistoryEntry[];
  rematchPlayerIds: Set<string>;
  latestEventId: string | null;
  chatMessages: ChatMessage[];
  chatRateLimits: Map<string, number[]>;
  nextChatMessageNumber: number;
  fatalError: SocketError | null;
  playbackTimer: ReturnType<typeof setTimeout> | null;
};

export type PveRoomManagerEvent =
  | { type: "ROOM_UPDATED"; roomCode: string }
  | { type: "TURN_RESOLVED"; roomCode: string; payload: PveTurnPlayback }
  | { type: "PLAYER_DISCONNECTED"; roomCode: string; playerId: string }
  | { type: "PLAYER_RECONNECTED"; roomCode: string; playerId: string }
  | { type: "CHAT_MESSAGE"; roomCode: string; message: ChatMessage };

export type PveRoomManagerOptions = {
  generateRoomCode: () => string;
  createPlayerId: () => string;
  createReconnectToken: () => string;
  now: () => number;
  playbackTimeoutMs: number | ((resolution: PveTurnResolution) => number);
  roomCodeExists: (roomCode: string) => boolean;
  logger: AppLogger;
};

const DEFAULT_OPTIONS: PveRoomManagerOptions = {
  generateRoomCode: () => createRoomCode(),
  createPlayerId: () => randomUUID(),
  createReconnectToken: () => `${randomUUID()}${randomUUID()}`,
  now: () => Date.now(),
  playbackTimeoutMs: getPveTurnPlaybackTimeoutMs,
  roomCodeExists: () => false,
  logger: noopLogger,
};

function clonePlans(plans: PvePlans): PvePlans {
  return {
    WARRIOR: plans.WARRIOR.map((action) => action ? structuredClone(action) : null) as PvePlans["WARRIOR"],
    ARCHER: plans.ARCHER.map((action) => action ? structuredClone(action) : null) as PvePlans["ARCHER"],
    MAGE: plans.MAGE.map((action) => action ? structuredClone(action) : null) as PvePlans["MAGE"],
    PRIEST: plans.PRIEST.map((action) => action ? structuredClone(action) : null) as PvePlans["PRIEST"],
  };
}

function nextPlans(state: PveBattleState): PvePlans {
  const plans = createEmptyPvePlans();
  const pass = createPassPvePlans();
  for (const characterId of PVE_CHARACTER_ORDER) {
    if (!state.characters[characterId].alive) plans[characterId] = pass[characterId];
  }
  return plans;
}

export class PveRoomManager {
  private readonly rooms = new Map<string, PveRoomState>();
  private readonly listeners = new Set<(event: PveRoomManagerEvent) => void>();
  private readonly options: PveRoomManagerOptions;

  constructor(options: Partial<PveRoomManagerOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  onEvent(listener: (event: PveRoomManagerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  createRoom(nicknameInput: string, socketId: string): PveRoomIdentityResult {
    const nickname = this.normalizeNickname(nicknameInput);
    const player = this.createPlayer(nickname, socketId, 1);
    const battleState = createInitialPveBattleState();
    const room: PveRoomState = {
      roomCode: this.uniqueRoomCode(),
      hostPlayerId: player.playerId,
      phase: "LOBBY",
      turnNumber: 1,
      players: [player],
      battleState,
      plans: createEmptyPvePlans(),
      confirmedPlayerIds: new Set(),
      bossPlan: createPveBossPlan(1, battleState),
      pendingPlayback: null,
      playbackFinishedPlayerIds: new Set(),
      history: [],
      rematchPlayerIds: new Set(),
      latestEventId: null,
      chatMessages: [],
      chatRateLimits: new Map(),
      nextChatMessageNumber: 1,
      fatalError: null,
      playbackTimer: null,
    };
    this.rooms.set(room.roomCode, room);
    this.addSystemMessage(room, `${nickname}님이 PvE 협동 방을 만들었습니다.`);
    this.options.logger.info("pve_room_created", {
      room: maskRoomCode(room.roomCode),
      player: maskPlayerId(player.playerId),
    });
    this.emit({ type: "ROOM_UPDATED", roomCode: room.roomCode });
    return this.identity(room, player);
  }

  joinRoom(roomCodeInput: string, nicknameInput: string, socketId: string): PveRoomIdentityResult {
    const room = this.getRoomOrThrow(roomCodeInput);
    const nickname = this.normalizeNickname(nicknameInput);
    if (room.phase !== "LOBBY") throw new RoomError("GAME_ALREADY_STARTED");
    if (room.players.length >= PVE_COOP_MAX_PLAYERS) throw new RoomError("ROOM_FULL");
    if (room.players.some((player) =>
      player.nickname.toLocaleLowerCase() === nickname.toLocaleLowerCase()
    )) throw new RoomError("NICKNAME_ALREADY_USED");
    const player = this.createPlayer(nickname, socketId, this.nextSeat(room));
    room.players.push(player);
    this.addSystemMessage(room, `${nickname}님이 참가했습니다.`);
    this.emitRoom(room);
    return this.identity(room, player);
  }

  reconnectRoom(credentials: SessionCredentials, socketId: string): PveRoomIdentityResult {
    const room = this.rooms.get(credentials.roomCode.toUpperCase());
    if (!room) throw new RoomError("ROOM_SESSION_EXPIRED");
    const player = room.players.find((candidate) => candidate.playerId === credentials.playerId);
    if (!player) throw new RoomError("PLAYER_NOT_FOUND");
    if (player.reconnectToken !== credentials.reconnectToken) {
      throw new RoomError("INVALID_RECONNECT_TOKEN");
    }
    if (player.connected && player.socketId === socketId) {
      return this.identity(room, player);
    }
    player.socketId = socketId;
    player.connected = true;
    this.addSystemMessage(room, `${player.nickname}님이 재접속했습니다.`);
    this.emit({ type: "PLAYER_RECONNECTED", roomCode: room.roomCode, playerId: player.playerId });
    this.emitRoom(room);
    return this.identity(room, player);
  }

  toggleCharacter(
    roomCode: string,
    playerId: string,
    socketId: string,
    characterId: PveCharacterId,
  ): PveCharacterId[] {
    const room = this.requireOwnedRoom(roomCode, playerId, socketId);
    if (room.phase !== "LOBBY") throw new RoomError("INVALID_GAME_PHASE");
    const player = this.player(room, playerId);
    if (player.assignedCharacterIds.includes(characterId)) {
      player.assignedCharacterIds = player.assignedCharacterIds.filter((id) => id !== characterId);
      player.ready = false;
      this.emitRoom(room);
      return [...player.assignedCharacterIds];
    }
    if (room.players.some((player) =>
      player.playerId !== playerId && player.assignedCharacterIds.includes(characterId)
    )) throw new RoomError("PVE_ROLE_TAKEN");
    if (player.assignedCharacterIds.length >= 2) throw new RoomError("PVE_CHARACTER_LIMIT");
    player.assignedCharacterIds.push(characterId);
    player.assignedCharacterIds.sort(
      (left, right) => PVE_CHARACTER_ORDER.indexOf(left) - PVE_CHARACTER_ORDER.indexOf(right),
    );
    player.ready = false;
    this.emitRoom(room);
    return [...player.assignedCharacterIds];
  }

  setReady(roomCode: string, playerId: string, socketId: string, ready: boolean): void {
    const room = this.requireOwnedRoom(roomCode, playerId, socketId);
    if (room.phase !== "LOBBY") throw new RoomError("INVALID_GAME_PHASE");
    const player = this.player(room, playerId);
    if (ready && player.assignedCharacterIds.length === 0) {
      throw new RoomError("CHARACTER_NOT_SELECTED", "최소 한 캐릭터를 담당해야 준비할 수 있습니다.");
    }
    player.ready = ready;
    this.emitRoom(room);
  }

  startGame(roomCode: string, playerId: string, socketId: string): void {
    const room = this.requireOwnedRoom(roomCode, playerId, socketId);
    if (room.hostPlayerId !== playerId) throw new RoomError("NOT_ROOM_HOST");
    if (room.phase !== "LOBBY") throw new RoomError("GAME_ALREADY_STARTED");
    if (room.players.length < PVE_COOP_MIN_PLAYERS) throw new RoomError("NOT_ENOUGH_PLAYERS");
    const assigned = new Set(room.players.flatMap((player) => player.assignedCharacterIds));
    const missing = PVE_CHARACTER_ORDER.find((characterId) => !assigned.has(characterId));
    if (missing) {
      throw new RoomError(
        "CHARACTER_NOT_SELECTED",
        `${room.battleState.characters[missing].name}가 아직 배정되지 않았습니다.`,
      );
    }
    if (room.players.some((player) => player.assignedCharacterIds.length === 0)) {
      throw new RoomError("CHARACTER_NOT_SELECTED", "모든 플레이어가 최소 한 캐릭터를 담당해야 합니다.");
    }
    if (room.players.some((player) => !player.connected || !player.ready)) {
      throw new RoomError("NOT_ALL_PLAYERS_READY");
    }
    this.resetBattle(room);
    room.phase = "PLANNING";
    this.addSystemMessage(room, "PvE 협동 전투가 시작되었습니다.");
    this.emitRoom(room);
  }

  setPlanSlot(
    roomCode: string,
    playerId: string,
    socketId: string,
    characterId: PveCharacterId,
    turnNumber: number,
    beat: 1 | 2 | 3,
    action: PvePlans[PveCharacterId][number],
  ): void {
    const room = this.requirePlanningRoom(roomCode, playerId, socketId, turnNumber);
    if (room.confirmedPlayerIds.has(playerId)) throw new RoomError("PVE_PLAN_LOCKED");
    const player = this.player(room, playerId);
    if (!player.assignedCharacterIds.includes(characterId)) {
      throw new RoomError("SOCKET_NOT_OWNER", "담당하지 않은 캐릭터의 계획은 수정할 수 없습니다.");
    }
    if (!room.battleState.characters[characterId].alive) throw new RoomError("PVE_CHARACTER_DEAD");
    if (action) {
      const validation = validatePvePlannedAction(
        room.battleState,
        room.plans,
        characterId,
        beat,
        action,
      );
      if (!validation.valid) throw new RoomError("PVE_PLAN_INVALID", validation.reason);
    }
    room.plans[characterId][beat - 1] = action ? structuredClone(action) : null;
    this.emitRoom(room);
  }

  setConfirmed(
    roomCode: string,
    playerId: string,
    socketId: string,
    turnNumber: number,
    confirmed: boolean,
  ): void {
    const room = this.requirePlanningRoom(roomCode, playerId, socketId, turnNumber);
    const assignedCharacterIds = this.player(room, playerId).assignedCharacterIds;
    if (confirmed && !assignedCharacterIds.every((characterId) =>
      room.plans[characterId].every(Boolean)
    )) {
      throw new RoomError(
        "PVE_PLAN_INVALID",
        "담당한 모든 캐릭터의 행동을 선택해야 계획을 확정할 수 있습니다.",
      );
    }
    if (confirmed) room.confirmedPlayerIds.add(playerId);
    else room.confirmedPlayerIds.delete(playerId);
    this.emitRoom(room);
    if (
      confirmed
      && room.phase === "PLANNING"
      && room.confirmedPlayerIds.size === room.players.length
    ) this.resolveTurn(room);
  }

  playbackFinished(roomCode: string, playerId: string, socketId: string, turnNumber: number): void {
    const room = this.requireOwnedRoom(roomCode, playerId, socketId);
    if (room.phase !== "RESOLVING" || room.turnNumber !== turnNumber || !room.pendingPlayback) {
      throw new RoomError(room.turnNumber !== turnNumber ? "PVE_TURN_MISMATCH" : "INVALID_GAME_PHASE");
    }
    room.playbackFinishedPlayerIds.add(playerId);
    const connectedIds = room.players.filter((player) => player.connected).map((player) => player.playerId);
    if (connectedIds.every((id) => room.playbackFinishedPlayerIds.has(id))) {
      this.advanceAfterPlayback(room, turnNumber);
    } else {
      this.emitRoom(room);
    }
  }

  requestRematch(roomCode: string, playerId: string, socketId: string): void {
    const room = this.requireOwnedRoom(roomCode, playerId, socketId);
    if (room.phase !== "RESULT") throw new RoomError("INVALID_GAME_PHASE");
    room.rematchPlayerIds.add(playerId);
    if (room.rematchPlayerIds.size === room.players.length) {
      this.resetBattle(room);
      room.phase = "PLANNING";
      this.addSystemMessage(room, "전원이 동의해 같은 직업으로 다시 시작합니다.");
    }
    this.emitRoom(room);
  }

  returnLobby(roomCode: string, playerId: string, socketId: string): void {
    const room = this.requireOwnedRoom(roomCode, playerId, socketId);
    if (room.phase !== "RESULT") throw new RoomError("INVALID_GAME_PHASE");
    if (room.hostPlayerId !== playerId) throw new RoomError("NOT_ROOM_HOST");
    this.resetBattle(room);
    room.phase = "LOBBY";
    for (const player of room.players) player.ready = false;
    this.addSystemMessage(room, "방장이 로비로 돌아갔습니다.");
    this.emitRoom(room);
  }

  sendChat(roomCode: string, playerId: string, socketId: string, messageInput: string): void {
    const room = this.requireOwnedRoom(roomCode, playerId, socketId);
    const message = messageInput.trim();
    if (!message) throw new RoomError("CHAT_EMPTY");
    if (message.length > CHAT_MESSAGE_MAX_LENGTH) throw new RoomError("CHAT_MESSAGE_TOO_LONG");
    const now = this.options.now();
    const attempts = (room.chatRateLimits.get(playerId) ?? [])
      .filter((timestamp) => timestamp > now - CHAT_RATE_WINDOW_MS);
    if (attempts.length >= CHAT_RATE_MAX_MESSAGES) throw new RoomError("CHAT_RATE_LIMITED");
    attempts.push(now);
    room.chatRateLimits.set(playerId, attempts);
    const player = this.player(room, playerId);
    const chat: ChatMessage = {
      id: `${room.roomCode}-pve-chat-${room.nextChatMessageNumber++}`,
      roomCode: room.roomCode,
      playerId,
      nickname: player.nickname,
      message,
      createdAt: now,
      kind: "PLAYER",
    };
    room.chatMessages.push(chat);
    room.chatMessages = room.chatMessages.slice(-CHAT_HISTORY_LIMIT);
    this.emit({ type: "CHAT_MESSAGE", roomCode: room.roomCode, message: chat });
    this.emitRoom(room);
  }

  leaveRoom(roomCode: string, playerId: string, socketId: string): void {
    const room = this.requireOwnedRoom(roomCode, playerId, socketId);
    if (room.phase === "LOBBY") {
      room.players = room.players.filter((player) => player.playerId !== playerId);
      if (room.players.length === 0) {
        this.deleteRoom(room);
        return;
      }
      if (room.hostPlayerId === playerId) room.hostPlayerId = room.players[0]!.playerId;
      this.emitRoom(room);
      return;
    }
    this.disconnectPlayer(room, this.player(room, playerId));
  }

  disconnectSocket(socketId: string): void {
    for (const room of this.rooms.values()) {
      const player = room.players.find((candidate) => candidate.socketId === socketId);
      if (player) {
        this.disconnectPlayer(room, player);
        return;
      }
    }
  }

  getRoom(roomCode: string): PveRoomState | undefined {
    return this.rooms.get(roomCode.toUpperCase());
  }

  getPlayerView(roomCode: string, playerId: string): PveCoopRoomView {
    const room = this.getRoomOrThrow(roomCode);
    const self = this.player(room, playerId);
    return {
      mode: "PVE_COOP",
      roomCode: room.roomCode,
      hostPlayerId: room.hostPlayerId,
      selfPlayerId: playerId,
      phase: room.phase,
      turnNumber: room.turnNumber,
      players: room.players.map((player) => ({
        playerId: player.playerId,
        nickname: player.nickname,
        seatNumber: player.seatNumber,
        assignedCharacterIds: [...player.assignedCharacterIds],
        connected: player.connected,
        ready: player.ready,
        confirmed: room.confirmedPlayerIds.has(player.playerId),
        rematchRequested: room.rematchPlayerIds.has(player.playerId),
      })),
      myAssignedCharacterIds: [...self.assignedCharacterIds],
      battleState: structuredClone(room.battleState),
      plans: clonePlans(room.plans),
      confirmedPlayerIds: [...room.confirmedPlayerIds],
      bossPlan: structuredClone(room.bossPlan),
      pendingPlayback: room.pendingPlayback ? structuredClone(room.pendingPlayback) : null,
      result: room.battleState.result,
      latestEventId: room.latestEventId,
      history: structuredClone(room.history),
      chatHistory: structuredClone(room.chatMessages),
      fatalError: room.fatalError,
    };
  }

  getRoomCount(): number { return this.rooms.size; }
  getConnectedPlayerCount(): number {
    return [...this.rooms.values()].reduce(
      (total, room) => total + room.players.filter((player) => player.connected).length,
      0,
    );
  }

  destroy(): void {
    for (const room of this.rooms.values()) {
      if (room.playbackTimer) clearTimeout(room.playbackTimer);
    }
    this.rooms.clear();
    this.listeners.clear();
  }

  private resolveTurn(room: PveRoomState): void {
    if (room.phase !== "PLANNING" || !isPvePlanComplete(room.plans)) return;
    const turnNumber = room.turnNumber;
    const startState = structuredClone(room.battleState);
    const plans = clonePlans(room.plans);
    let resolution;
    try {
      resolution = resolvePveTurn(startState, plans, room.bossPlan);
    } catch (error) {
      room.fatalError = new RoomError("GAME_ENGINE_FAILURE").toSocketError();
      room.phase = "RESULT";
      this.options.logger.error("pve_resolve_failed", {
        room: maskRoomCode(room.roomCode), turnNumber, error,
      });
      this.emitRoom(room);
      return;
    }
    room.battleState = structuredClone(resolution.state);
    room.latestEventId = resolution.events.at(-1)?.id ?? null;
    room.pendingPlayback = { turnNumber, startState, resolution };
    room.history.push({
      turnNumber,
      plans,
      events: structuredClone(resolution.events),
      finalState: structuredClone(resolution.state),
    });
    room.phase = "RESOLVING";
    room.playbackFinishedPlayerIds.clear();
    this.emit({ type: "TURN_RESOLVED", roomCode: room.roomCode, payload: room.pendingPlayback });
    this.emitRoom(room);
    room.playbackTimer = setTimeout(
      () => this.advanceAfterPlayback(room, turnNumber),
      typeof this.options.playbackTimeoutMs === "function"
        ? this.options.playbackTimeoutMs(resolution)
        : this.options.playbackTimeoutMs,
    );
  }

  private advanceAfterPlayback(room: PveRoomState, turnNumber: number): void {
    if (room.phase !== "RESOLVING" || room.turnNumber !== turnNumber) return;
    if (room.playbackTimer) clearTimeout(room.playbackTimer);
    room.playbackTimer = null;
    if (room.battleState.result !== "IN_PROGRESS") {
      room.phase = "RESULT";
      this.addSystemMessage(
        room,
        room.battleState.result === "VICTORY" ? "훈련용 골렘을 쓰러뜨렸습니다." : "파티가 전멸했습니다.",
      );
    } else {
      room.turnNumber += 1;
      room.phase = "PLANNING";
      room.plans = nextPlans(room.battleState);
      room.confirmedPlayerIds.clear();
      room.bossPlan = createPveBossPlan(room.turnNumber, room.battleState);
      room.pendingPlayback = null;
      room.playbackFinishedPlayerIds.clear();
      this.addSystemMessage(room, `${room.turnNumber}턴 계획을 시작합니다.`);
    }
    this.emitRoom(room);
  }

  private resetBattle(room: PveRoomState): void {
    if (room.playbackTimer) clearTimeout(room.playbackTimer);
    room.playbackTimer = null;
    room.turnNumber = 1;
    room.battleState = createInitialPveBattleState();
    room.plans = createEmptyPvePlans();
    room.confirmedPlayerIds.clear();
    room.bossPlan = createPveBossPlan(1, room.battleState);
    room.pendingPlayback = null;
    room.playbackFinishedPlayerIds.clear();
    room.history = [];
    room.rematchPlayerIds.clear();
    room.latestEventId = null;
    room.fatalError = null;
  }

  private requirePlanningRoom(roomCode: string, playerId: string, socketId: string, turnNumber: number): PveRoomState {
    const room = this.requireOwnedRoom(roomCode, playerId, socketId);
    if (room.phase !== "PLANNING") throw new RoomError("INVALID_GAME_PHASE");
    if (room.turnNumber !== turnNumber) throw new RoomError("PVE_TURN_MISMATCH");
    return room;
  }

  private requireOwnedRoom(roomCode: string, playerId: string, socketId: string): PveRoomState {
    const room = this.getRoomOrThrow(roomCode);
    const player = this.player(room, playerId);
    if (player.socketId !== socketId || !player.connected) throw new RoomError("SOCKET_NOT_OWNER");
    return room;
  }

  private disconnectPlayer(room: PveRoomState, player: PvePlayerSession): void {
    if (!player.connected) return;
    player.connected = false;
    player.socketId = null;
    this.addSystemMessage(room, `${player.nickname}님의 연결이 끊어졌습니다.`);
    this.emit({ type: "PLAYER_DISCONNECTED", roomCode: room.roomCode, playerId: player.playerId });
    this.emitRoom(room);
    if (room.phase === "RESOLVING") {
      const connected = room.players.filter((candidate) => candidate.connected);
      if (connected.every((candidate) => room.playbackFinishedPlayerIds.has(candidate.playerId))) {
        this.advanceAfterPlayback(room, room.turnNumber);
      }
    }
  }

  private addSystemMessage(room: PveRoomState, message: string): void {
    const chat: ChatMessage = {
      id: `${room.roomCode}-pve-chat-${room.nextChatMessageNumber++}`,
      roomCode: room.roomCode,
      playerId: null,
      nickname: null,
      message,
      createdAt: this.options.now(),
      kind: "SYSTEM",
    };
    room.chatMessages.push(chat);
    room.chatMessages = room.chatMessages.slice(-CHAT_HISTORY_LIMIT);
    this.emit({ type: "CHAT_MESSAGE", roomCode: room.roomCode, message: chat });
  }

  private normalizeNickname(input: string): string {
    const parsed = NicknameSchema.safeParse(input);
    if (!parsed.success) throw new RoomError("INVALID_NICKNAME");
    return parsed.data;
  }

  private uniqueRoomCode(): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const roomCode = this.options.generateRoomCode().toUpperCase();
      if (!this.rooms.has(roomCode) && !this.options.roomCodeExists(roomCode)) return roomCode;
    }
    throw new RoomError("ROOM_CODE_GENERATION_FAILED");
  }

  private createPlayer(nickname: string, socketId: string, seatNumber: number): PvePlayerSession {
    return {
      playerId: this.options.createPlayerId(),
      reconnectToken: this.options.createReconnectToken(),
      socketId,
      nickname,
      seatNumber,
      assignedCharacterIds: [],
      connected: true,
      ready: false,
    };
  }

  private nextSeat(room: PveRoomState): number {
    for (let seat = 1; seat <= PVE_COOP_MAX_PLAYERS; seat += 1) {
      if (!room.players.some((player) => player.seatNumber === seat)) return seat;
    }
    return room.players.length + 1;
  }

  private player(room: PveRoomState, playerId: string): PvePlayerSession {
    const player = room.players.find((candidate) => candidate.playerId === playerId);
    if (!player) throw new RoomError("PLAYER_NOT_FOUND");
    return player;
  }

  private getRoomOrThrow(roomCode: string): PveRoomState {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) throw new RoomError("ROOM_NOT_FOUND");
    return room;
  }

  private identity(room: PveRoomState, player: PvePlayerSession): PveRoomIdentityResult {
    return {
      credentials: {
        roomCode: room.roomCode,
        playerId: player.playerId,
        reconnectToken: player.reconnectToken,
      },
      view: this.getPlayerView(room.roomCode, player.playerId),
    };
  }

  private emitRoom(room: PveRoomState): void {
    this.emit({ type: "ROOM_UPDATED", roomCode: room.roomCode });
  }

  private emit(event: PveRoomManagerEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private deleteRoom(room: PveRoomState): void {
    if (room.playbackTimer) clearTimeout(room.playbackTimer);
    this.rooms.delete(room.roomCode);
  }
}
