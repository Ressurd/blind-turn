import { randomUUID } from "node:crypto";
import {
  ABANDONED_ROOM_TTL_MS,
  ACTION_TIMEOUT_MS,
  CHAT_HISTORY_LIMIT,
  CHAT_MESSAGE_MAX_LENGTH,
  CHAT_RATE_MAX_MESSAGES,
  CHAT_RATE_WINDOW_MS,
  DISCONNECT_GRACE_MS,
  EVENTS_FINISH_TIMEOUT_MS,
  MAX_ROOM_PLAYERS,
  MIN_GAME_PLAYERS,
  NicknameSchema,
  ProductionRandomSource,
  REWARD_TIMEOUT_MS,
  getDeckSize,
  type CharacterClassId,
  type ChatMessage,
  type PlayerGameView,
  type QueuedCardAction,
  type RoundResolvedPayload,
  type RoundSubmissionStatusPayload,
  type SessionCredentials,
  type SocketError,
} from "@blind-turn/shared";
import { GameSession, type RandomSourceFactory } from "../game/game-session";
import { createPlayerView } from "../game/player-view";
import {
  maskPlayerId,
  maskRoomCode,
  noopLogger,
  type AppLogger,
} from "../logging/logger";
import { createRoomCode } from "./room-code";
import { RoomError } from "./room-error";
import type { PlayerSession, RoomState } from "./room-state";

export type RoomManagerEvent =
  | { type: "ROOM_UPDATED"; roomCode: string }
  | { type: "ROOM_DELETED"; roomCode: string }
  | { type: "PLAYER_DISCONNECTED"; roomCode: string; playerId: string }
  | { type: "PLAYER_RECONNECTED"; roomCode: string; playerId: string }
  | {
      type: "CHARACTER_SELECTED";
      roomCode: string;
      playerId: string;
      characterId: CharacterClassId;
    }
  | { type: "GAME_STARTED"; roomCode: string; roundNumber: number }
  | {
      type: "QUEUE_UPDATED";
      roomCode: string;
      playerId: string;
      queuedCards: QueuedCardAction[];
    }
  | {
      type: "ROUND_SUBMISSION_STATUS";
      roomCode: string;
      payload: RoundSubmissionStatusPayload;
    }
  | { type: "ROUND_LOCKED"; roomCode: string; roundNumber: number }
  | {
      type: "CARD_COUNTS_REVEALED";
      roomCode: string;
      roundNumber: number;
      cardCounts: Array<{ playerId: string; count: number }>;
    }
  | { type: "ROUND_RESOLVING"; roomCode: string; roundNumber: number }
  | { type: "ROUND_RESOLVED"; roomCode: string; payload: RoundResolvedPayload }
  | {
      type: "NEXT_ROUND";
      roomCode: string;
      roundNumber: number;
      actionDeadlineAt: number;
    }
  | { type: "REWARD_OPTIONS"; roomCode: string; deadlineAt: number }
  | { type: "REWARD_SELECTED"; roomCode: string; playerId: string }
  | { type: "DECK_REMOVAL_REQUIRED"; roomCode: string; deadlineAt: number }
  | { type: "DECK_UPDATED"; roomCode: string; playerId: string; deckSize: number }
  | {
      type: "GAME_FINISHED";
      roomCode: string;
      result: NonNullable<RoundResolvedPayload["publicState"]["result"]>;
      totalRounds: number;
    }
  | { type: "CHAT_MESSAGE"; roomCode: string; message: ChatMessage }
  | { type: "GAME_ERROR"; roomCode: string; error: SocketError };

export type RoomManagerOptions = {
  generateRoomCode: () => string;
  createPlayerId: () => string;
  createReconnectToken: () => string;
  randomSourceFactory: RandomSourceFactory;
  now: () => number;
  actionTimeoutMs: number;
  eventsFinishTimeoutMs: number;
  rewardTimeoutMs: number;
  disconnectGraceMs: number;
  abandonedRoomTtlMs: number;
  logger: AppLogger;
};

type RoomIdentityResult = {
  credentials: SessionCredentials;
  view: PlayerGameView;
};

const DEFAULT_OPTIONS: RoomManagerOptions = {
  generateRoomCode: () => createRoomCode(),
  createPlayerId: () => randomUUID(),
  createReconnectToken: () => `${randomUUID()}${randomUUID()}`,
  randomSourceFactory: () => new ProductionRandomSource(),
  now: () => Date.now(),
  actionTimeoutMs: ACTION_TIMEOUT_MS,
  eventsFinishTimeoutMs: EVENTS_FINISH_TIMEOUT_MS,
  rewardTimeoutMs: REWARD_TIMEOUT_MS,
  disconnectGraceMs: DISCONNECT_GRACE_MS,
  abandonedRoomTtlMs: ABANDONED_ROOM_TTL_MS,
  logger: noopLogger,
};

export class RoomManager {
  private readonly rooms = new Map<string, RoomState>();
  private readonly listeners = new Set<(event: RoomManagerEvent) => void>();
  private readonly options: RoomManagerOptions;

  constructor(options: Partial<RoomManagerOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  onEvent(listener: (event: RoomManagerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  createRoom(nicknameInput: string, socketId: string): RoomIdentityResult {
    const nickname = this.normalizeNickname(nicknameInput);
    const roomCode = this.uniqueRoomCode();
    const player = this.createPlayer(nickname, socketId, 1);
    const now = this.options.now();
    const room: RoomState = {
      roomCode,
      hostPlayerId: player.playerId,
      phase: "LOBBY",
      players: [player],
      game: null,
      actionDeadlineAt: null,
      rewardDeadlineAt: null,
      lockedCardCounts: new Map(),
      chatMessages: [],
      chatRateLimits: new Map(),
      nextChatMessageNumber: 1,
      fatalError: null,
      createdAt: now,
      updatedAt: now,
      timers: {
        action: null,
        playback: null,
        reward: null,
        cleanup: null,
        disconnects: new Map(),
      },
    };
    this.rooms.set(roomCode, room);
    this.addSystemMessage(room, `${nickname}님이 방을 만들었습니다.`);
    this.options.logger.info("room_created", {
      room: maskRoomCode(roomCode),
      player: maskPlayerId(player.playerId),
      phase: room.phase,
    });
    this.emit({ type: "ROOM_UPDATED", roomCode });
    return {
      credentials: this.credentials(room, player),
      view: createPlayerView(room, player.playerId),
    };
  }

  joinRoom(
    roomCodeInput: string,
    nicknameInput: string,
    socketId: string,
  ): RoomIdentityResult {
    const room = this.getRoomOrThrow(roomCodeInput);
    const nickname = this.normalizeNickname(nicknameInput);
    if (room.phase !== "LOBBY") throw new RoomError("GAME_ALREADY_STARTED");
    if (room.players.length >= MAX_ROOM_PLAYERS) throw new RoomError("ROOM_FULL");
    if (room.players.some((player) =>
      player.nickname.toLocaleLowerCase() === nickname.toLocaleLowerCase()
    )) {
      throw new RoomError("NICKNAME_ALREADY_USED");
    }
    const player = this.createPlayer(
      nickname,
      socketId,
      this.nextSeatNumber(room.players),
    );
    room.players.push(player);
    this.addSystemMessage(room, `${nickname}님이 참가했습니다.`);
    this.touch(room);
    this.emit({ type: "ROOM_UPDATED", roomCode: room.roomCode });
    return {
      credentials: this.credentials(room, player),
      view: createPlayerView(room, player.playerId),
    };
  }

  reconnectRoom(
    credentials: SessionCredentials,
    socketId: string,
  ): RoomIdentityResult {
    const room = this.rooms.get(credentials.roomCode.toUpperCase());
    if (!room) throw new RoomError("ROOM_SESSION_EXPIRED");
    const player = room.players.find(
      (candidate) => candidate.playerId === credentials.playerId,
    );
    if (!player) throw new RoomError("PLAYER_NOT_FOUND");
    if (player.reconnectToken !== credentials.reconnectToken) {
      throw new RoomError("INVALID_RECONNECT_TOKEN");
    }
    player.socketId = socketId;
    player.connected = true;
    this.clearDisconnectTimer(room, player.playerId);
    if (room.timers.cleanup) {
      clearTimeout(room.timers.cleanup);
      room.timers.cleanup = null;
    }
    this.scheduleDisconnectedLobbyPlayers(room);
    this.addSystemMessage(room, `${player.nickname}님이 재접속했습니다.`);
    this.touch(room);
    this.emit({
      type: "PLAYER_RECONNECTED",
      roomCode: room.roomCode,
      playerId: player.playerId,
    });
    this.emit({ type: "ROOM_UPDATED", roomCode: room.roomCode });
    return {
      credentials: this.credentials(room, player),
      view: createPlayerView(room, player.playerId),
    };
  }

  selectCharacter(
    roomCode: string,
    playerId: string,
    socketId: string,
    characterId: CharacterClassId,
  ): void {
    const room = this.getRoomOrThrow(roomCode);
    const player = this.assertOwnership(room, playerId, socketId);
    if (room.phase !== "LOBBY") throw new RoomError("INVALID_GAME_PHASE");
    player.characterId = characterId;
    player.ready = false;
    this.touch(room);
    this.emit({
      type: "CHARACTER_SELECTED",
      roomCode: room.roomCode,
      playerId,
      characterId,
    });
    this.emit({ type: "ROOM_UPDATED", roomCode: room.roomCode });
  }

  setReady(
    roomCode: string,
    playerId: string,
    socketId: string,
    ready: boolean,
  ): void {
    const room = this.getRoomOrThrow(roomCode);
    const player = this.assertOwnership(room, playerId, socketId);
    if (room.phase !== "LOBBY") throw new RoomError("INVALID_GAME_PHASE");
    if (ready && !player.characterId) throw new RoomError("CHARACTER_NOT_SELECTED");
    player.ready = ready;
    this.touch(room);
    this.emit({ type: "ROOM_UPDATED", roomCode: room.roomCode });
  }

  startGame(roomCode: string, playerId: string, socketId: string): void {
    const room = this.getRoomOrThrow(roomCode);
    this.assertOwnership(room, playerId, socketId);
    if (room.hostPlayerId !== playerId) throw new RoomError("NOT_ROOM_HOST");
    if (room.phase !== "LOBBY") throw new RoomError("GAME_ALREADY_STARTED");
    if (room.players.length < MIN_GAME_PLAYERS) {
      throw new RoomError("NOT_ENOUGH_PLAYERS");
    }
    if (room.players.some((player) => !player.characterId)) {
      throw new RoomError("CHARACTER_NOT_SELECTED");
    }
    if (room.players.some((player) => !player.connected || !player.ready)) {
      throw new RoomError("NOT_ALL_PLAYERS_READY");
    }

    room.game = new GameSession(this.options.randomSourceFactory);
    room.fatalError = null;
    room.lockedCardCounts.clear();
    const state = room.game.start(room.players.map((player) => ({
      id: player.playerId,
      nickname: player.nickname,
      seatNumber: player.seatNumber,
      characterId: player.characterId!,
    })));
    room.phase = state.phase;
    if (state.phase === "SELECTING_CARDS") {
      this.scheduleActionTimer(room, state.roundNumber);
    }
    this.addSystemMessage(room, "게임이 시작되었습니다.");
    this.touch(room);
    this.emit({
      type: "GAME_STARTED",
      roomCode: room.roomCode,
      roundNumber: state.roundNumber,
    });
    if (state.phase === "SELECTING_CARDS") this.emitSubmissionStatus(room);
    this.emit({ type: "ROOM_UPDATED", roomCode: room.roomCode });
  }

  selectInitialHand(
    roomCode: string,
    playerId: string,
    socketId: string,
    selectedInstanceIds: string[],
  ): void {
    const room = this.getRoomOrThrow(roomCode);
    this.assertOwnership(room, playerId, socketId);
    if (room.phase !== "ROUND_STARTING" || !room.game) {
      throw new RoomError("INVALID_GAME_PHASE");
    }
    room.game.selectInitialHand(playerId, selectedInstanceIds);
    const state = room.game.getState();
    if (state.phase === "SELECTING_CARDS") {
      room.phase = "SELECTING_CARDS";
      this.scheduleActionTimer(room, state.roundNumber);
      this.emit({
        type: "NEXT_ROUND",
        roomCode: room.roomCode,
        roundNumber: state.roundNumber,
        actionDeadlineAt: room.actionDeadlineAt!,
      });
      this.emitSubmissionStatus(room);
    }
    this.touch(room);
    this.emit({ type: "ROOM_UPDATED", roomCode: room.roomCode });
  }

  queueCard(
    roomCode: string,
    playerId: string,
    socketId: string,
    roundNumber: number,
    input: Omit<QueuedCardAction, "order"> & { order?: 0 | 1 | 2 },
  ): void {
    const room = this.requireSelectingRoom(roomCode, playerId, socketId);
    room.game!.queue(playerId, roundNumber, input);
    this.emitQueueUpdated(room, playerId);
  }

  moveQueuedCard(
    roomCode: string,
    playerId: string,
    socketId: string,
    roundNumber: number,
    cardInstanceId: string,
    order: 0 | 1 | 2,
  ): void {
    const room = this.requireSelectingRoom(roomCode, playerId, socketId);
    room.game!.moveQueued(playerId, roundNumber, cardInstanceId, order);
    this.emitQueueUpdated(room, playerId);
  }

  removeQueuedCard(
    roomCode: string,
    playerId: string,
    socketId: string,
    roundNumber: number,
    cardInstanceId: string,
  ): void {
    const room = this.requireSelectingRoom(roomCode, playerId, socketId);
    room.game!.removeQueued(playerId, roundNumber, cardInstanceId);
    this.emitQueueUpdated(room, playerId);
  }

  reorderQueuedCards(
    roomCode: string,
    playerId: string,
    socketId: string,
    roundNumber: number,
    orderedInstanceIds: string[],
  ): void {
    const room = this.requireSelectingRoom(roomCode, playerId, socketId);
    room.game!.reorderQueued(playerId, roundNumber, orderedInstanceIds);
    this.emitQueueUpdated(room, playerId);
  }

  confirmRound(
    roomCode: string,
    playerId: string,
    socketId: string,
    roundNumber: number,
  ): void {
    const room = this.requireSelectingRoom(roomCode, playerId, socketId);
    room.game!.confirm(playerId, roundNumber);
    this.touch(room);
    this.emitSubmissionStatus(room);
    this.emit({ type: "ROOM_UPDATED", roomCode: room.roomCode });
    if (room.game!.haveAllAlivePlayersConfirmed()) {
      this.resolveRoomRound(room, roundNumber);
    }
  }

  eventsFinished(
    roomCode: string,
    playerId: string,
    socketId: string,
    roundNumber: number,
  ): void {
    const room = this.getRoomOrThrow(roomCode);
    this.assertOwnership(room, playerId, socketId);
    if (room.phase !== "RESOLVING_ROUND" || !room.game) {
      throw new RoomError("INVALID_GAME_PHASE");
    }
    room.game.markEventsFinished(playerId, roundNumber);
    const connectedIds = room.players
      .filter((player) => player.connected)
      .map((player) => player.playerId);
    if (room.game.havePlayersFinishedEvents(connectedIds)) {
      this.advanceAfterPlayback(room, roundNumber);
    }
  }

  selectReward(
    roomCode: string,
    playerId: string,
    socketId: string,
    cardId: string,
  ): void {
    const room = this.getRoomOrThrow(roomCode);
    this.assertOwnership(room, playerId, socketId);
    if (room.phase !== "SELECTING_REWARD" || !room.game) {
      throw new RoomError("INVALID_GAME_PHASE");
    }
    const before = this.playerDeckSize(room, playerId);
    room.game.chooseReward(playerId, cardId);
    this.emit({ type: "REWARD_SELECTED", roomCode: room.roomCode, playerId });
    const after = this.playerDeckSize(room, playerId);
    if (after !== before) {
      this.emit({ type: "DECK_UPDATED", roomCode: room.roomCode, playerId, deckSize: after });
    }
    this.afterRewardChoice(room);
  }

  selectDeckRemoval(
    roomCode: string,
    playerId: string,
    socketId: string,
    cardInstanceId: string,
  ): void {
    const room = this.getRoomOrThrow(roomCode);
    this.assertOwnership(room, playerId, socketId);
    if (room.phase !== "SELECTING_DECK_REMOVAL" || !room.game) {
      throw new RoomError("INVALID_GAME_PHASE");
    }
    room.game.removeDeckCard(playerId, cardInstanceId);
    this.emit({
      type: "DECK_UPDATED",
      roomCode: room.roomCode,
      playerId,
      deckSize: this.playerDeckSize(room, playerId),
    });
    this.afterDeckRemoval(room);
  }

  sendChat(
    roomCode: string,
    playerId: string,
    socketId: string,
    rawMessage: string,
  ): ChatMessage {
    const room = this.getRoomOrThrow(roomCode);
    const player = this.assertOwnership(room, playerId, socketId);
    const message = rawMessage.trim().replace(/\s+/g, " ");
    if (!message) throw new RoomError("CHAT_EMPTY");
    if (message.length > CHAT_MESSAGE_MAX_LENGTH) {
      throw new RoomError("CHAT_MESSAGE_TOO_LONG");
    }
    const gamePlayer = room.game?.getState().players.find(
      (candidate) => candidate.id === playerId,
    );
    if (gamePlayer && !gamePlayer.alive) throw new RoomError("CHAT_DEAD_PLAYER");

    const now = this.options.now();
    const recent = (room.chatRateLimits.get(playerId) ?? []).filter(
      (timestamp) => now - timestamp < CHAT_RATE_WINDOW_MS,
    );
    if (recent.length >= CHAT_RATE_MAX_MESSAGES) {
      throw new RoomError("CHAT_RATE_LIMITED");
    }
    recent.push(now);
    room.chatRateLimits.set(playerId, recent);
    const chatMessage = this.appendChatMessage(room, {
      playerId,
      nickname: player.nickname,
      message,
      kind: "PLAYER",
    });
    this.touch(room);
    return chatMessage;
  }

  requestRematch(roomCode: string, playerId: string, socketId: string): void {
    const room = this.getRoomOrThrow(roomCode);
    this.assertOwnership(room, playerId, socketId);
    if (room.hostPlayerId !== playerId) throw new RoomError("NOT_ROOM_HOST");
    if (room.phase !== "FINISHED") throw new RoomError("INVALID_GAME_PHASE");
    this.clearGameTimers(room);
    room.game = null;
    room.phase = "LOBBY";
    room.actionDeadlineAt = null;
    room.rewardDeadlineAt = null;
    room.lockedCardCounts.clear();
    room.chatRateLimits.clear();
    room.fatalError = null;
    room.players = room.players.filter((player) => player.connected);
    for (const player of room.players) {
      player.ready = false;
      player.characterId = null;
    }
    this.addSystemMessage(room, "재경기를 준비합니다. 캐릭터를 다시 선택해 주세요.");
    this.touch(room);
    this.emit({ type: "ROOM_UPDATED", roomCode: room.roomCode });
  }

  handleActionTimeout(roomCode: string, roundNumber: number): void {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room || room.phase !== "SELECTING_CARDS") return;
    this.resolveRoomRound(room, roundNumber);
  }

  handleRewardTimeout(roomCode: string): void {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room?.game) return;
    if (room.phase === "SELECTING_REWARD") {
      room.game.chooseRandomRewards();
      for (const player of room.game.getState().players.filter((candidate) => candidate.alive)) {
        this.emit({
          type: "DECK_UPDATED",
          roomCode: room.roomCode,
          playerId: player.id,
          deckSize: getDeckSize(player.deckState),
        });
      }
      this.afterRewardChoice(room);
      return;
    }
    if (room.phase === "SELECTING_DECK_REMOVAL") {
      room.game.removeAutomaticDeckCards();
      for (const player of room.game.getState().players.filter((candidate) => candidate.alive)) {
        this.emit({
          type: "DECK_UPDATED",
          roomCode: room.roomCode,
          playerId: player.id,
          deckSize: getDeckSize(player.deckState),
        });
      }
      this.afterDeckRemoval(room);
    }
  }

  leaveRoom(roomCode: string, playerId: string, socketId: string): void {
    const room = this.getRoomOrThrow(roomCode);
    const player = this.assertOwnership(room, playerId, socketId);
    this.addSystemMessage(room, `${player.nickname}님이 나갔습니다.`);
    if (room.phase === "LOBBY") {
      this.removePlayer(room, player.playerId);
      return;
    }
    player.connected = false;
    player.socketId = null;
    this.transferHost(room);
    this.scheduleRoomCleanupIfEmpty(room);
    this.touch(room);
    this.emit({ type: "PLAYER_DISCONNECTED", roomCode: room.roomCode, playerId });
    this.emit({ type: "ROOM_UPDATED", roomCode: room.roomCode });
  }

  disconnectSocket(socketId: string): void {
    for (const room of this.rooms.values()) {
      const player = room.players.find((candidate) => candidate.socketId === socketId);
      if (!player) continue;
      player.connected = false;
      player.socketId = null;
      this.transferHost(room);
      this.scheduleRoomCleanupIfEmpty(room);
      if (room.players.some((candidate) => candidate.connected)) {
        this.scheduleDisconnectedLobbyPlayers(room);
      }
      this.addSystemMessage(room, `${player.nickname}님의 연결이 끊겼습니다.`);
      this.touch(room);
      this.emit({
        type: "PLAYER_DISCONNECTED",
        roomCode: room.roomCode,
        playerId: player.playerId,
      });
      this.emit({ type: "ROOM_UPDATED", roomCode: room.roomCode });
      return;
    }
  }

  getRoom(roomCode: string): RoomState | undefined {
    return this.rooms.get(roomCode.toUpperCase());
  }

  getPlayerView(roomCode: string, playerId: string): PlayerGameView {
    return createPlayerView(this.getRoomOrThrow(roomCode), playerId);
  }

  getRoomCount(): number {
    return this.rooms.size;
  }

  getConnectedPlayerCount(): number {
    let connected = 0;
    for (const room of this.rooms.values()) {
      connected += room.players.filter((player) => player.connected).length;
    }
    return connected;
  }

  destroy(): void {
    for (const room of [...this.rooms.values()]) this.deleteRoom(room);
    this.listeners.clear();
  }

  private emit(event: RoomManagerEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private touch(room: RoomState): void {
    room.updatedAt = this.options.now();
  }

  private normalizeNickname(nickname: string): string {
    const result = NicknameSchema.safeParse(nickname);
    if (!result.success) throw new RoomError("INVALID_NICKNAME");
    return result.data;
  }

  private uniqueRoomCode(): string {
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      const roomCode = this.options.generateRoomCode().toUpperCase();
      if (!this.rooms.has(roomCode)) return roomCode;
    }
    throw new RoomError("ROOM_CODE_GENERATION_FAILED");
  }

  private nextSeatNumber(players: PlayerSession[]): number {
    const occupied = new Set(players.map((player) => player.seatNumber));
    for (let seat = 1; seat <= MAX_ROOM_PLAYERS; seat += 1) {
      if (!occupied.has(seat)) return seat;
    }
    throw new RoomError("ROOM_FULL");
  }

  private createPlayer(
    nickname: string,
    socketId: string,
    seatNumber: number,
  ): PlayerSession {
    return {
      playerId: this.options.createPlayerId(),
      reconnectToken: this.options.createReconnectToken(),
      socketId,
      nickname,
      seatNumber,
      characterId: null,
      connected: true,
      ready: false,
    };
  }

  private credentials(room: RoomState, player: PlayerSession): SessionCredentials {
    return {
      roomCode: room.roomCode,
      playerId: player.playerId,
      reconnectToken: player.reconnectToken,
    };
  }

  private getRoomOrThrow(roomCode: string): RoomState {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) throw new RoomError("ROOM_NOT_FOUND");
    return room;
  }

  private assertOwnership(
    room: RoomState,
    playerId: string,
    socketId: string,
  ): PlayerSession {
    const player = room.players.find((candidate) => candidate.playerId === playerId);
    if (!player) throw new RoomError("PLAYER_NOT_FOUND");
    if (!player.connected || player.socketId !== socketId) {
      throw new RoomError("SOCKET_NOT_OWNER");
    }
    return player;
  }

  private requireSelectingRoom(
    roomCode: string,
    playerId: string,
    socketId: string,
  ): RoomState {
    const room = this.getRoomOrThrow(roomCode);
    this.assertOwnership(room, playerId, socketId);
    if (room.phase !== "SELECTING_CARDS" || !room.game) {
      throw new RoomError("INVALID_GAME_PHASE");
    }
    return room;
  }

  private emitQueueUpdated(room: RoomState, playerId: string): void {
    const player = room.game!.getState().players.find((candidate) => candidate.id === playerId);
    this.touch(room);
    this.emit({
      type: "QUEUE_UPDATED",
      roomCode: room.roomCode,
      playerId,
      queuedCards: player?.deckState.queuedCards.map((queued) => ({ ...queued })) ?? [],
    });
    this.emit({ type: "ROOM_UPDATED", roomCode: room.roomCode });
  }

  private emitSubmissionStatus(room: RoomState): void {
    if (!room.game) return;
    this.emit({
      type: "ROUND_SUBMISSION_STATUS",
      roomCode: room.roomCode,
      payload: {
        roundNumber: room.game.getState().roundNumber,
        confirmedPlayerIds: room.game.getConfirmedPlayerIds(),
      },
    });
  }

  private scheduleActionTimer(room: RoomState, roundNumber: number): void {
    if (room.timers.action) clearTimeout(room.timers.action);
    room.actionDeadlineAt = this.options.now() + this.options.actionTimeoutMs;
    room.timers.action = setTimeout(
      () => this.runRoomTimer(room, "action_timeout", () =>
        this.handleActionTimeout(room.roomCode, roundNumber)),
      this.options.actionTimeoutMs,
    );
  }

  private resolveRoomRound(room: RoomState, roundNumber: number): void {
    if (!room.game || room.phase !== "SELECTING_CARDS") return;
    const stateBefore = room.game.getState();
    if (stateBefore.roundNumber !== roundNumber) return;
    const cardCounts = stateBefore.players
      .filter((player) => player.alive)
      .map((player) => ({
        playerId: player.id,
        count: player.deckState.queuedCards.length,
      }));
    room.lockedCardCounts = new Map(
      cardCounts.map(({ playerId, count }) => [playerId, count]),
    );
    let payload: RoundResolvedPayload | null;
    try {
      payload = room.game.resolveCurrentRound(roundNumber);
    } catch (error) {
      this.finishGameWithError(room, roundNumber, error);
      return;
    }
    if (!payload) return;
    if (room.timers.action) clearTimeout(room.timers.action);
    room.timers.action = null;
    room.actionDeadlineAt = null;
    room.phase = "RESOLVING_ROUND";
    this.touch(room);
    this.emit({ type: "ROUND_LOCKED", roomCode: room.roomCode, roundNumber });
    this.emit({
      type: "CARD_COUNTS_REVEALED",
      roomCode: room.roomCode,
      roundNumber,
      cardCounts,
    });
    this.emit({ type: "ROUND_RESOLVING", roomCode: room.roomCode, roundNumber });
    this.emit({ type: "ROUND_RESOLVED", roomCode: room.roomCode, payload });
    this.emit({ type: "ROOM_UPDATED", roomCode: room.roomCode });
    room.timers.playback = setTimeout(
      () => this.runRoomTimer(room, "playback_timeout", () =>
        this.advanceAfterPlayback(room, roundNumber)),
      this.options.eventsFinishTimeoutMs,
    );
  }

  private advanceAfterPlayback(room: RoomState, resolvedRound: number): void {
    if (
      room.phase !== "RESOLVING_ROUND"
      || !room.game
      || room.game.getLastResolvedRound() !== resolvedRound
    ) return;
    if (room.timers.playback) clearTimeout(room.timers.playback);
    room.timers.playback = null;
    const state = room.game.getState();
    if (state.phase === "FINISHED" && state.result) {
      room.phase = "FINISHED";
      this.addSystemMessage(room, "게임이 종료되었습니다.");
      this.emit({
        type: "GAME_FINISHED",
        roomCode: room.roomCode,
        result: state.result,
        totalRounds: state.roundNumber,
      });
    } else if (state.phase === "SELECTING_REWARD") {
      room.phase = "SELECTING_REWARD";
      this.scheduleRewardTimer(room);
      this.emit({
        type: "REWARD_OPTIONS",
        roomCode: room.roomCode,
        deadlineAt: room.rewardDeadlineAt!,
      });
    } else if (state.phase === "ROUND_STARTING") {
      this.startNextRound(room);
      return;
    } else {
      this.finishGameWithError(room, resolvedRound, new Error(`Unexpected phase: ${state.phase}`));
      return;
    }
    this.touch(room);
    this.emit({ type: "ROOM_UPDATED", roomCode: room.roomCode });
  }

  private scheduleRewardTimer(room: RoomState): void {
    if (room.timers.reward) clearTimeout(room.timers.reward);
    room.rewardDeadlineAt = this.options.now() + this.options.rewardTimeoutMs;
    room.timers.reward = setTimeout(
      () => this.runRoomTimer(room, "reward_timeout", () =>
        this.handleRewardTimeout(room.roomCode)),
      this.options.rewardTimeoutMs,
    );
  }

  private afterRewardChoice(room: RoomState): void {
    const phase = room.game!.getState().phase;
    if (phase === "SELECTING_REWARD") {
      this.touch(room);
      this.emit({ type: "ROOM_UPDATED", roomCode: room.roomCode });
      return;
    }
    if (room.timers.reward) clearTimeout(room.timers.reward);
    room.timers.reward = null;
    if (phase === "SELECTING_DECK_REMOVAL") {
      room.phase = "SELECTING_DECK_REMOVAL";
      this.scheduleRewardTimer(room);
      this.emit({
        type: "DECK_REMOVAL_REQUIRED",
        roomCode: room.roomCode,
        deadlineAt: room.rewardDeadlineAt!,
      });
      this.touch(room);
      this.emit({ type: "ROOM_UPDATED", roomCode: room.roomCode });
      return;
    }
    if (phase === "ROUND_STARTING") {
      room.rewardDeadlineAt = null;
      this.startNextRound(room);
      return;
    }
    this.finishGameWithError(room, room.game!.getState().roundNumber, new Error(`Unexpected reward phase: ${phase}`));
  }

  private afterDeckRemoval(room: RoomState): void {
    const phase = room.game!.getState().phase;
    if (phase === "SELECTING_DECK_REMOVAL") {
      this.touch(room);
      this.emit({ type: "ROOM_UPDATED", roomCode: room.roomCode });
      return;
    }
    if (phase === "ROUND_STARTING") {
      if (room.timers.reward) clearTimeout(room.timers.reward);
      room.timers.reward = null;
      room.rewardDeadlineAt = null;
      this.startNextRound(room);
      return;
    }
    this.finishGameWithError(room, room.game!.getState().roundNumber, new Error(`Unexpected removal phase: ${phase}`));
  }

  private startNextRound(room: RoomState): void {
    const state = room.game!.startNextRound();
    room.phase = "SELECTING_CARDS";
    room.lockedCardCounts.clear();
    room.rewardDeadlineAt = null;
    this.scheduleActionTimer(room, state.roundNumber);
    this.touch(room);
    this.emit({
      type: "NEXT_ROUND",
      roomCode: room.roomCode,
      roundNumber: state.roundNumber,
      actionDeadlineAt: room.actionDeadlineAt!,
    });
    this.emitSubmissionStatus(room);
    this.emit({ type: "ROOM_UPDATED", roomCode: room.roomCode });
  }

  private playerDeckSize(room: RoomState, playerId: string): number {
    const player = room.game!.getState().players.find((candidate) => candidate.id === playerId);
    if (!player) throw new RoomError("PLAYER_NOT_FOUND");
    return getDeckSize(player.deckState);
  }

  private appendChatMessage(
    room: RoomState,
    input: Pick<ChatMessage, "playerId" | "nickname" | "message" | "kind">,
  ): ChatMessage {
    const message: ChatMessage = {
      id: `${room.roomCode}:${room.nextChatMessageNumber++}`,
      roomCode: room.roomCode,
      createdAt: this.options.now(),
      ...input,
    };
    room.chatMessages.push(message);
    if (room.chatMessages.length > CHAT_HISTORY_LIMIT) {
      room.chatMessages.splice(0, room.chatMessages.length - CHAT_HISTORY_LIMIT);
    }
    this.emit({ type: "CHAT_MESSAGE", roomCode: room.roomCode, message });
    return message;
  }

  private addSystemMessage(room: RoomState, message: string): ChatMessage {
    return this.appendChatMessage(room, {
      playerId: null,
      nickname: null,
      message,
      kind: "SYSTEM",
    });
  }

  private transferHost(room: RoomState): void {
    const host = room.players.find((player) => player.playerId === room.hostPlayerId);
    if (host?.connected) return;
    const nextHost = room.players
      .filter((player) => player.connected)
      .sort((left, right) => left.seatNumber - right.seatNumber)[0];
    if (nextHost) room.hostPlayerId = nextHost.playerId;
  }

  private clearDisconnectTimer(room: RoomState, playerId: string): void {
    const timer = room.timers.disconnects.get(playerId);
    if (timer) clearTimeout(timer);
    room.timers.disconnects.delete(playerId);
  }

  private scheduleDisconnectedLobbyPlayers(room: RoomState): void {
    if (room.phase !== "LOBBY") return;
    for (const player of room.players) {
      if (player.connected || room.timers.disconnects.has(player.playerId)) continue;
      room.timers.disconnects.set(player.playerId, setTimeout(
        () => this.runRoomTimer(room, "disconnect_grace", () =>
          this.removeDisconnectedLobbyPlayer(room.roomCode, player.playerId)),
        this.options.disconnectGraceMs,
      ));
    }
  }

  private removeDisconnectedLobbyPlayer(roomCode: string, playerId: string): void {
    const room = this.rooms.get(roomCode);
    const player = room?.players.find((candidate) => candidate.playerId === playerId);
    if (!room || !player || player.connected || room.phase !== "LOBBY") return;
    this.removePlayer(room, playerId);
  }

  private removePlayer(room: RoomState, playerId: string): void {
    this.clearDisconnectTimer(room, playerId);
    room.players = room.players.filter((player) => player.playerId !== playerId);
    if (room.players.length === 0) {
      this.deleteRoom(room);
      return;
    }
    this.transferHost(room);
    this.touch(room);
    this.emit({ type: "ROOM_UPDATED", roomCode: room.roomCode });
  }

  private scheduleRoomCleanupIfEmpty(room: RoomState): void {
    if (room.players.some((player) => player.connected) || room.timers.cleanup) return;
    for (const playerId of [...room.timers.disconnects.keys()]) {
      this.clearDisconnectTimer(room, playerId);
    }
    room.timers.cleanup = setTimeout(
      () => this.runRoomTimer(room, "abandoned_room_cleanup", () => {
        const current = this.rooms.get(room.roomCode);
        if (current && current.players.every((player) => !player.connected)) {
          this.deleteRoom(current);
        }
      }),
      this.options.abandonedRoomTtlMs,
    );
  }

  private runRoomTimer(room: RoomState, timerType: string, operation: () => void): void {
    try {
      operation();
    } catch (error) {
      this.options.logger.error("room_timer_failed", {
        room: maskRoomCode(room.roomCode),
        phase: room.phase,
        timerType,
        error,
      });
      if (room.game && room.phase !== "FINISHED") {
        this.finishGameWithError(room, room.game.getState().roundNumber, error);
      }
    }
  }

  private finishGameWithError(room: RoomState, roundNumber: number, error: unknown): void {
    this.clearGameTimers(room);
    room.phase = "FINISHED";
    room.actionDeadlineAt = null;
    room.rewardDeadlineAt = null;
    room.fatalError = new RoomError("GAME_ENGINE_FAILURE").toSocketError();
    this.touch(room);
    this.options.logger.error("game_engine_failed", {
      room: maskRoomCode(room.roomCode),
      phase: room.phase,
      roundNumber,
      error,
    });
    this.emit({ type: "GAME_ERROR", roomCode: room.roomCode, error: room.fatalError });
    this.emit({ type: "ROOM_UPDATED", roomCode: room.roomCode });
  }

  private clearGameTimers(room: RoomState): void {
    if (room.timers.action) clearTimeout(room.timers.action);
    if (room.timers.playback) clearTimeout(room.timers.playback);
    if (room.timers.reward) clearTimeout(room.timers.reward);
    room.timers.action = null;
    room.timers.playback = null;
    room.timers.reward = null;
  }

  private deleteRoom(room: RoomState): void {
    this.clearGameTimers(room);
    if (room.timers.cleanup) clearTimeout(room.timers.cleanup);
    room.timers.cleanup = null;
    for (const timer of room.timers.disconnects.values()) clearTimeout(timer);
    room.timers.disconnects.clear();
    this.rooms.delete(room.roomCode);
    this.options.logger.info("room_deleted", {
      room: maskRoomCode(room.roomCode),
      phase: room.phase,
    });
    this.emit({ type: "ROOM_DELETED", roomCode: room.roomCode });
  }
}
