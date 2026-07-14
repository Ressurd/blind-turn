import {
  EventsFinishedPayloadSchema,
  RoomCodePayloadSchema,
  SubmitActionPayloadSchema,
} from "@blind-turn/shared";
import type { RoomManager } from "../rooms/room-manager";
import type { AppLogger } from "../logging/logger";
import { parsePayload, runSocketRequest } from "./socket-handler";
import { requireSocketSession, type GameSocket } from "./socket-session";

export function registerGameEvents(
  socket: GameSocket,
  roomManager: RoomManager,
  logger: AppLogger,
): void {
  socket.on("game:submit-action", (payload, ack) => {
    runSocketRequest(socket, "game", ack, () => {
      const parsed = parsePayload(SubmitActionPayloadSchema, payload);
      const session = requireSocketSession(socket, parsed.roomCode);
      roomManager.submitAction(
        parsed.roomCode,
        session.playerId,
        socket.id,
        parsed.turnNumber,
        parsed.action,
      );
      socket.emit("game:action-accepted", { turnNumber: parsed.turnNumber });
      return { accepted: true as const };
    }, logger);
  });

  socket.on("game:events-finished", (payload, ack) => {
    runSocketRequest(socket, "game", ack, () => {
      const parsed = parsePayload(EventsFinishedPayloadSchema, payload);
      const session = requireSocketSession(socket, parsed.roomCode);
      roomManager.eventsFinished(
        parsed.roomCode,
        session.playerId,
        socket.id,
        parsed.turnNumber,
      );
      return { accepted: true as const };
    }, logger);
  });

  socket.on("game:request-rematch", (payload, ack) => {
    runSocketRequest(socket, "game", ack, () => {
      const parsed = parsePayload(RoomCodePayloadSchema, payload);
      const session = requireSocketSession(socket, parsed.roomCode);
      roomManager.requestRematch(parsed.roomCode, session.playerId, socket.id);
      return { reset: true as const };
    }, logger);
  });
}
