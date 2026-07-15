import { ChatSendPayloadSchema } from "@blind-turn/shared";
import type { AppLogger } from "../logging/logger";
import type { RoomManager } from "../rooms/room-manager";
import { parsePayload, runSocketRequest } from "./socket-handler";
import { requireSocketSession, type GameSocket } from "./socket-session";

export function registerChatEvents(
  socket: GameSocket,
  roomManager: RoomManager,
  logger: AppLogger,
): void {
  socket.on("chat:send", (payload, ack) => {
    runSocketRequest(socket, "chat", ack, () => {
      const parsed = parsePayload(ChatSendPayloadSchema, payload);
      const session = requireSocketSession(socket, parsed.roomCode);
      roomManager.sendChat(parsed.roomCode, session.playerId, socket.id, parsed.message);
      return { sent: true as const };
    }, logger);
  });
}
