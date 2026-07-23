import type { ZodType } from "zod";
import type { SocketAckCallback, SocketError } from "@blind-turn/shared";
import { RoomError, toRoomError } from "../rooms/room-error";
import { noopLogger, type AppLogger } from "../logging/logger";
import type { GameSocket } from "./socket-session";

export function parsePayload<T>(schema: ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new RoomError(
      "INVALID_PAYLOAD",
      result.error.issues[0]?.message ?? "요청 형식이 올바르지 않습니다.",
    );
  }
  return result.data;
}

export function runSocketRequest<T>(
  socket: GameSocket,
  channel: "room" | "game" | "chat" | "pve",
  ack: SocketAckCallback<T>,
  operation: () => T,
  logger: AppLogger = noopLogger,
): void {
  try {
    ack({ ok: true, data: operation() });
  } catch (error) {
    const socketError: SocketError = toRoomError(error).toSocketError();
    logger.warn("socket_request_failed", {
      channel,
      socketId: socket.id.slice(0, 8),
      errorCode: socketError.code,
      unexpected: !(error instanceof RoomError),
      error: error instanceof RoomError ? undefined : error,
    });
    ack({ ok: false, error: socketError });
    socket.emit(`${channel}:error`, socketError);
  }
}
