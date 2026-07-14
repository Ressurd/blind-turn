import {
  RoomCodePayloadSchema,
  RoomCreatePayloadSchema,
  RoomJoinPayloadSchema,
  RoomReconnectPayloadSchema,
  SetReadyPayloadSchema,
} from "@blind-turn/shared";
import type { RoomManager } from "../rooms/room-manager";
import type { AppLogger } from "../logging/logger";
import { parsePayload, runSocketRequest } from "./socket-handler";
import {
  bindSocketSession,
  clearSocketSession,
  requireSocketSession,
  type GameSocket,
} from "./socket-session";

export function registerRoomEvents(
  socket: GameSocket,
  roomManager: RoomManager,
  logger: AppLogger,
): void {
  socket.on("room:create", (payload, ack) => {
    runSocketRequest(socket, "room", ack, () => {
      const parsed = parsePayload(RoomCreatePayloadSchema, payload);
      const result = roomManager.createRoom(parsed.nickname, socket.id);
      bindSocketSession(
        socket,
        result.credentials.roomCode,
        result.credentials.playerId,
      );
      void socket.join(result.credentials.roomCode);
      socket.emit("room:created", result);
      return result;
    }, logger);
  });

  socket.on("room:join", (payload, ack) => {
    runSocketRequest(socket, "room", ack, () => {
      const parsed = parsePayload(RoomJoinPayloadSchema, payload);
      const result = roomManager.joinRoom(
        parsed.roomCode,
        parsed.nickname,
        socket.id,
      );
      bindSocketSession(
        socket,
        result.credentials.roomCode,
        result.credentials.playerId,
      );
      void socket.join(result.credentials.roomCode);
      socket.emit("room:joined", result);
      return result;
    }, logger);
  });

  socket.on("room:reconnect", (payload, ack) => {
    runSocketRequest(socket, "room", ack, () => {
      const parsed = parsePayload(RoomReconnectPayloadSchema, payload);
      const result = roomManager.reconnectRoom(parsed, socket.id);
      bindSocketSession(
        socket,
        result.credentials.roomCode,
        result.credentials.playerId,
      );
      void socket.join(result.credentials.roomCode);
      return result;
    }, logger);
  });

  socket.on("room:leave", (payload, ack) => {
    runSocketRequest(socket, "room", ack, () => {
      const parsed = parsePayload(RoomCodePayloadSchema, payload);
      const session = requireSocketSession(socket, parsed.roomCode);
      roomManager.leaveRoom(
        parsed.roomCode,
        session.playerId,
        socket.id,
      );
      void socket.leave(parsed.roomCode);
      clearSocketSession(socket);
      return { left: true as const };
    }, logger);
  });

  socket.on("room:set-ready", (payload, ack) => {
    runSocketRequest(socket, "room", ack, () => {
      const parsed = parsePayload(SetReadyPayloadSchema, payload);
      const session = requireSocketSession(socket, parsed.roomCode);
      roomManager.setReady(
        parsed.roomCode,
        session.playerId,
        socket.id,
        parsed.ready,
      );
      return { ready: parsed.ready };
    }, logger);
  });

  socket.on("room:start-game", (payload, ack) => {
    runSocketRequest(socket, "room", ack, () => {
      const parsed = parsePayload(RoomCodePayloadSchema, payload);
      const session = requireSocketSession(socket, parsed.roomCode);
      roomManager.startGame(parsed.roomCode, session.playerId, socket.id);
      return { started: true as const };
    }, logger);
  });
}
