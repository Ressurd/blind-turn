import { randomUUID } from "node:crypto";
import {
  ABANDONED_ROOM_TTL_MS,
  ACTION_TIMEOUT_MS,
  DISCONNECT_GRACE_MS,
  EVENTS_FINISH_TIMEOUT_MS,
  MAX_ROOM_PLAYERS,
  MIN_GAME_PLAYERS,
  NicknameSchema,
  type PlayerAction,
  type PlayerGameView,
  type SessionCredentials,
  type SocketError,
  type SubmissionStatusPayload,
  type TurnResolvedPayload,
  ProductionRandomSource,
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
      type: "GAME_STARTED";
      roomCode: string;
      turnNumber: number;
      actionDeadlineAt: number;
    }
  | {
      type: "SUBMISSION_STATUS";
      roomCode: string;
      payload: SubmissionStatusPayload;
    }
  | { type: "TURN_RESOLVING"; roomCode: string; turnNumber: number }
  | { type: "TURN_RESOLVED"; roomCode: string; payload: TurnResolvedPayload }
  | {
      type: "NEXT_TURN";
      roomCode: string;
      turnNumber: number;
      actionDeadlineAt: number;
    }
  | {
      type: "GAME_FINISHED";
      roomCode: string;
      result: NonNullable<TurnResolvedPayload["publicState"]["result"]>;
      totalTurns: number;
    }
  | { type: "GAME_ERROR"; roomCode: string; error: SocketError };

export type RoomManagerOptions = {
  generateRoomCode: () => string;
  createPlayerId: () => string;
  createReconnectToken: () => string;
  randomSourceFactory: RandomSourceFactory;
  now: () => number;
  actionTimeoutMs: number;
  eventsFinishTimeoutMs: number;
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
      fatalError: null,
      createdAt: now,
      updatedAt: now,
      timers: {
        action: null,
        nextTurn: null,
        cleanup: null,
        disconnects: new Map(),
      },
    };
    this.rooms.set(roomCode, room);
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
    if (
      room.players.some(
        (player) =>
          player.nickname.toLocaleLowerCase() === nickname.toLocaleLowerCase(),
      )
    ) {
      throw new RoomError("NICKNAME_ALREADY_USED");
    }
    const player = this.createPlayer(
      nickname,
      socketId,
      this.nextSeatNumber(room.players),
    );
    room.players.push(player);
    this.touch(room);
    this.options.logger.info("room_joined", {
      room: maskRoomCode(room.roomCode),
      player: maskPlayerId(player.playerId),
      phase: room.phase,
      playerCount: room.players.length,
    });
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
    this.touch(room);
    this.options.logger.info("player_reconnected", {
      room: maskRoomCode(room.roomCode),
      player: maskPlayerId(player.playerId),
      phase: room.phase,
    });
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

  setReady(
    roomCode: string,
    playerId: string,
    socketId: string,
    ready: boolean,
  ): void {
    const room = this.getRoomOrThrow(roomCode);
    const player = this.assertOwnership(room, playerId, socketId);
    if (room.phase !== "LOBBY") throw new RoomError("INVALID_GAME_PHASE");
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
    if (room.players.some((player) => !player.connected || !player.ready)) {
      throw new RoomError("NOT_ALL_PLAYERS_READY");
    }

    room.game = new GameSession(this.options.randomSourceFactory);
    room.fatalError = null;
    const state = room.game.start(
      room.players.map((player) => ({
        id: player.playerId,
        nickname: player.nickname,
        seatNumber: player.seatNumber,
      })),
    );
    room.phase = "SELECTING_ACTION";
    this.scheduleActionTimer(room, state.turnNumber);
    this.touch(room);
    this.options.logger.info("game_started", {
      room: maskRoomCode(room.roomCode),
      player: maskPlayerId(playerId),
      phase: room.phase,
      turnNumber: state.turnNumber,
    });
    this.options.logger.info("turn_started", {
      room: maskRoomCode(room.roomCode),
      turnNumber: state.turnNumber,
    });
    this.emit({
      type: "GAME_STARTED",
      roomCode: room.roomCode,
      turnNumber: state.turnNumber,
      actionDeadlineAt: room.actionDeadlineAt!,
    });
    this.emit({ type: "ROOM_UPDATED", roomCode: room.roomCode });
  }

  submitAction(
    roomCode: string,
    playerId: string,
    socketId: string,
    turnNumber: number,
    action: PlayerAction,
  ): void {
    const room = this.getRoomOrThrow(roomCode);
    this.assertOwnership(room, playerId, socketId);
    if (room.phase !== "SELECTING_ACTION" || !room.game) {
      throw new RoomError("INVALID_GAME_PHASE");
    }
    room.game.submit(playerId, turnNumber, action);
    this.touch(room);
    this.emitSubmissionStatus(room);
    this.emit({ type: "ROOM_UPDATED", roomCode: room.roomCode });
    if (room.game.haveAllAlivePlayersSubmitted()) {
      this.resolveRoomTurn(room, turnNumber);
    }
  }

  eventsFinished(
    roomCode: string,
    playerId: string,
    socketId: string,
    turnNumber: number,
  ): void {
    const room = this.getRoomOrThrow(roomCode);
    this.assertOwnership(room, playerId, socketId);
    if (room.phase !== "RESOLVING" || !room.game) {
      throw new RoomError("INVALID_GAME_PHASE");
    }
    room.game.markEventsFinished(playerId, turnNumber);
    const aliveConnectedIds = room.players
      .filter((session) => {
        const gamePlayer = room.game!.getState().players.find(
          (candidate) => candidate.id === session.playerId,
        );
        return session.connected && gamePlayer?.alive;
      })
      .map((session) => session.playerId);
    if (room.game.havePlayersFinishedEvents(aliveConnectedIds)) {
      this.startNextTurn(room, turnNumber);
    }
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
    room.fatalError = null;
    room.players = room.players.filter((player) => player.connected);
    room.players.forEach((player) => {
      player.ready = false;
    });
    this.touch(room);
    this.emit({ type: "ROOM_UPDATED", roomCode: room.roomCode });
  }

  handleActionTimeout(roomCode: string, turnNumber: number): void {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room || room.phase !== "SELECTING_ACTION") return;
    this.resolveRoomTurn(room, turnNumber);
  }

  leaveRoom(roomCode: string, playerId: string, socketId: string): void {
    const room = this.getRoomOrThrow(roomCode);
    const player = this.assertOwnership(room, playerId, socketId);
    if (room.phase === "LOBBY") {
      this.removePlayer(room, player.playerId);
    } else {
      player.connected = false;
      player.socketId = null;
      this.transferHost(room);
      this.scheduleRoomCleanupIfEmpty(room);
      this.touch(room);
      this.options.logger.info("player_disconnected", {
        room: maskRoomCode(room.roomCode),
        player: maskPlayerId(player.playerId),
        phase: room.phase,
        reason: "leave",
      });
      this.emit({
        type: "PLAYER_DISCONNECTED",
        roomCode: room.roomCode,
        playerId: player.playerId,
      });
      this.emit({ type: "ROOM_UPDATED", roomCode: room.roomCode });
    }
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
      this.touch(room);
      this.options.logger.info("player_disconnected", {
        room: maskRoomCode(room.roomCode),
        player: maskPlayerId(player.playerId),
        phase: room.phase,
        reason: "transport",
      });
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
    let connectedPlayers = 0;
    for (const room of this.rooms.values()) {
      connectedPlayers += room.players.filter((player) => player.connected).length;
    }
    return connectedPlayers;
  }

  destroy(): void {
    for (const room of [...this.rooms.values()]) this.deleteRoom(room);
    this.listeners.clear();
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

  private scheduleActionTimer(room: RoomState, turnNumber: number): void {
    if (room.timers.action) clearTimeout(room.timers.action);
    room.actionDeadlineAt = this.options.now() + this.options.actionTimeoutMs;
    room.timers.action = setTimeout(
      () =>
        this.runRoomTimer(room, "action_timeout", () =>
          this.handleActionTimeout(room.roomCode, turnNumber),
        ),
      this.options.actionTimeoutMs,
    );
  }

  private resolveRoomTurn(room: RoomState, turnNumber: number): void {
    if (!room.game) return;
    let payload: TurnResolvedPayload | null;
    try {
      payload = room.game.resolveCurrentTurn(turnNumber);
    } catch (error) {
      this.finishGameWithError(room, turnNumber, error);
      return;
    }
    if (!payload) return;
    if (room.timers.action) {
      clearTimeout(room.timers.action);
      room.timers.action = null;
    }
    room.actionDeadlineAt = null;
    room.phase = payload.publicState.result ? "FINISHED" : "RESOLVING";
    this.touch(room);
    this.emit({ type: "TURN_RESOLVING", roomCode: room.roomCode, turnNumber });
    this.emit({ type: "TURN_RESOLVED", roomCode: room.roomCode, payload });
    this.emit({ type: "ROOM_UPDATED", roomCode: room.roomCode });
    this.options.logger.info("turn_resolved", {
      room: maskRoomCode(room.roomCode),
      phase: room.phase,
      turnNumber,
      finished: Boolean(payload.publicState.result),
    });
    if (payload.publicState.result) {
      this.options.logger.info("game_finished", {
        room: maskRoomCode(room.roomCode),
        turnNumber: payload.turnNumber,
        resultType: payload.publicState.result.type,
      });
      this.emit({
        type: "GAME_FINISHED",
        roomCode: room.roomCode,
        result: payload.publicState.result,
        totalTurns: payload.turnNumber,
      });
      return;
    }
    room.timers.nextTurn = setTimeout(
      () =>
        this.runRoomTimer(room, "next_turn", () =>
          this.startNextTurn(room, turnNumber),
        ),
      this.options.eventsFinishTimeoutMs,
    );
  }

  private startNextTurn(room: RoomState, resolvedTurnNumber: number): void {
    if (
      room.phase !== "RESOLVING" ||
      !room.game ||
      room.game.getLastResolvedTurn() !== resolvedTurnNumber
    ) {
      return;
    }
    if (room.timers.nextTurn) {
      clearTimeout(room.timers.nextTurn);
      room.timers.nextTurn = null;
    }
    const state = room.game.startNextTurn();
    room.phase = "SELECTING_ACTION";
    this.scheduleActionTimer(room, state.turnNumber);
    this.touch(room);
    this.options.logger.info("turn_started", {
      room: maskRoomCode(room.roomCode),
      turnNumber: state.turnNumber,
    });
    this.emit({
      type: "NEXT_TURN",
      roomCode: room.roomCode,
      turnNumber: state.turnNumber,
      actionDeadlineAt: room.actionDeadlineAt!,
    });
    this.emitSubmissionStatus(room);
    this.emit({ type: "ROOM_UPDATED", roomCode: room.roomCode });
  }

  private emitSubmissionStatus(room: RoomState): void {
    if (!room.game) return;
    this.emit({
      type: "SUBMISSION_STATUS",
      roomCode: room.roomCode,
      payload: {
        turnNumber: room.game.getState().turnNumber,
        submittedPlayerIds: room.game.getSubmittedPlayerIds(),
      },
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
      room.timers.disconnects.set(
        player.playerId,
        setTimeout(
          () =>
            this.runRoomTimer(room, "disconnect_grace", () =>
              this.removeDisconnectedLobbyPlayer(room.roomCode, player.playerId),
            ),
          this.options.disconnectGraceMs,
        ),
      );
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
      () =>
        this.runRoomTimer(room, "abandoned_room_cleanup", () => {
          const current = this.rooms.get(room.roomCode);
          if (current && current.players.every((player) => !player.connected)) {
            this.deleteRoom(current);
          }
        }),
      this.options.abandonedRoomTtlMs,
    );
  }

  private runRoomTimer(
    room: RoomState,
    timerType: string,
    operation: () => void,
  ): void {
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
        this.finishGameWithError(
          room,
          room.game.getState().turnNumber,
          error,
        );
      }
    }
  }

  private finishGameWithError(
    room: RoomState,
    turnNumber: number,
    error: unknown,
  ): void {
    this.clearGameTimers(room);
    room.phase = "FINISHED";
    room.actionDeadlineAt = null;
    room.fatalError = new RoomError("GAME_ENGINE_FAILURE").toSocketError();
    this.touch(room);
    this.options.logger.error("game_engine_failed", {
      room: maskRoomCode(room.roomCode),
      phase: room.phase,
      turnNumber,
      error,
    });
    this.emit({
      type: "GAME_ERROR",
      roomCode: room.roomCode,
      error: room.fatalError,
    });
    this.emit({ type: "ROOM_UPDATED", roomCode: room.roomCode });
  }

  private clearGameTimers(room: RoomState): void {
    if (room.timers.action) clearTimeout(room.timers.action);
    if (room.timers.nextTurn) clearTimeout(room.timers.nextTurn);
    room.timers.action = null;
    room.timers.nextTurn = null;
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
