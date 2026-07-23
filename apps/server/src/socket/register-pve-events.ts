import {
  ChatSendPayloadSchema,
  PveSelectCharacterPayloadSchema,
  PveSetConfirmedPayloadSchema,
  PveSetPlanSlotPayloadSchema,
  PveTurnPayloadSchema,
  RoomCodePayloadSchema,
  RoomCreatePayloadSchema,
  RoomJoinPayloadSchema,
  RoomReconnectPayloadSchema,
  SetReadyPayloadSchema,
} from "@blind-turn/shared";
import type { AppLogger } from "../logging/logger";
import type { PveRoomManager } from "../pve/pve-room-manager";
import { parsePayload, runSocketRequest } from "./socket-handler";
import {
  bindSocketSession,
  clearSocketSession,
  requireSocketSession,
  type GameSocket,
} from "./socket-session";

export function registerPveEvents(
  socket: GameSocket,
  manager: PveRoomManager,
  logger: AppLogger,
): void {
  socket.on("pve:room:create", (payload, ack) => {
    runSocketRequest(socket, "pve", ack, () => {
      const parsed = parsePayload(RoomCreatePayloadSchema, payload);
      const result = manager.createRoom(parsed.nickname, socket.id);
      bindSocketSession(socket, result.credentials.roomCode, result.credentials.playerId, "PVE_COOP");
      void socket.join(result.credentials.roomCode);
      return result;
    }, logger);
  });

  socket.on("pve:room:join", (payload, ack) => {
    runSocketRequest(socket, "pve", ack, () => {
      const parsed = parsePayload(RoomJoinPayloadSchema, payload);
      const result = manager.joinRoom(parsed.roomCode, parsed.nickname, socket.id);
      bindSocketSession(socket, result.credentials.roomCode, result.credentials.playerId, "PVE_COOP");
      void socket.join(result.credentials.roomCode);
      return result;
    }, logger);
  });

  socket.on("pve:room:reconnect", (payload, ack) => {
    runSocketRequest(socket, "pve", ack, () => {
      const parsed = parsePayload(RoomReconnectPayloadSchema, payload);
      const result = manager.reconnectRoom(parsed, socket.id);
      bindSocketSession(socket, result.credentials.roomCode, result.credentials.playerId, "PVE_COOP");
      void socket.join(result.credentials.roomCode);
      return result;
    }, logger);
  });

  socket.on("pve:room:leave", (payload, ack) => {
    runSocketRequest(socket, "pve", ack, () => {
      const parsed = parsePayload(RoomCodePayloadSchema, payload);
      const session = requireSocketSession(socket, parsed.roomCode);
      manager.leaveRoom(parsed.roomCode, session.playerId, socket.id);
      void socket.leave(parsed.roomCode);
      clearSocketSession(socket);
      return { left: true as const };
    }, logger);
  });

  socket.on("pve:room:select-character", (payload, ack) => {
    runSocketRequest(socket, "pve", ack, () => {
      const parsed = parsePayload(PveSelectCharacterPayloadSchema, payload);
      const session = requireSocketSession(socket, parsed.roomCode);
      const assignedCharacterIds = manager.toggleCharacter(
        parsed.roomCode,
        session.playerId,
        socket.id,
        parsed.characterId,
      );
      return { assignedCharacterIds };
    }, logger);
  });

  socket.on("pve:room:set-ready", (payload, ack) => {
    runSocketRequest(socket, "pve", ack, () => {
      const parsed = parsePayload(SetReadyPayloadSchema, payload);
      const session = requireSocketSession(socket, parsed.roomCode);
      manager.setReady(parsed.roomCode, session.playerId, socket.id, parsed.ready);
      return { ready: parsed.ready };
    }, logger);
  });

  socket.on("pve:room:start", (payload, ack) => {
    runSocketRequest(socket, "pve", ack, () => {
      const parsed = parsePayload(RoomCodePayloadSchema, payload);
      const session = requireSocketSession(socket, parsed.roomCode);
      manager.startGame(parsed.roomCode, session.playerId, socket.id);
      return { started: true as const };
    }, logger);
  });

  socket.on("pve:plan:set-slot", (payload, ack) => {
    runSocketRequest(socket, "pve", ack, () => {
      const parsed = parsePayload(PveSetPlanSlotPayloadSchema, payload);
      const session = requireSocketSession(socket, parsed.roomCode);
      manager.setPlanSlot(
        parsed.roomCode,
        session.playerId,
        socket.id,
        parsed.characterId,
        parsed.turnNumber,
        parsed.beat,
        parsed.action
          ? {
            actionId: parsed.action.actionId,
            ...(parsed.action.target ? { target: parsed.action.target } : {}),
          }
          : null,
      );
      return { accepted: true as const };
    }, logger);
  });

  socket.on("pve:plan:set-confirmed", (payload, ack) => {
    runSocketRequest(socket, "pve", ack, () => {
      const parsed = parsePayload(PveSetConfirmedPayloadSchema, payload);
      const session = requireSocketSession(socket, parsed.roomCode);
      manager.setConfirmed(
        parsed.roomCode,
        session.playerId,
        socket.id,
        parsed.turnNumber,
        parsed.confirmed,
      );
      return { confirmed: parsed.confirmed };
    }, logger);
  });

  socket.on("pve:playback-finished", (payload, ack) => {
    runSocketRequest(socket, "pve", ack, () => {
      const parsed = parsePayload(PveTurnPayloadSchema, payload);
      const session = requireSocketSession(socket, parsed.roomCode);
      manager.playbackFinished(parsed.roomCode, session.playerId, socket.id, parsed.turnNumber);
      return { accepted: true as const };
    }, logger);
  });

  socket.on("pve:request-rematch", (payload, ack) => {
    runSocketRequest(socket, "pve", ack, () => {
      const parsed = parsePayload(RoomCodePayloadSchema, payload);
      const session = requireSocketSession(socket, parsed.roomCode);
      manager.requestRematch(parsed.roomCode, session.playerId, socket.id);
      return { accepted: true as const };
    }, logger);
  });

  socket.on("pve:return-lobby", (payload, ack) => {
    runSocketRequest(socket, "pve", ack, () => {
      const parsed = parsePayload(RoomCodePayloadSchema, payload);
      const session = requireSocketSession(socket, parsed.roomCode);
      manager.returnLobby(parsed.roomCode, session.playerId, socket.id);
      return { returned: true as const };
    }, logger);
  });

  socket.on("pve:chat:send", (payload, ack) => {
    runSocketRequest(socket, "pve", ack, () => {
      const parsed = parsePayload(ChatSendPayloadSchema, payload);
      const session = requireSocketSession(socket, parsed.roomCode);
      manager.sendChat(parsed.roomCode, session.playerId, socket.id, parsed.message);
      return { sent: true as const };
    }, logger);
  });
}
