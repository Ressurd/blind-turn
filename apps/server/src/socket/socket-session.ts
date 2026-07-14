import type { Socket } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SocketData,
} from "@blind-turn/shared";
import { RoomError } from "../rooms/room-error";

export type GameSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

export function bindSocketSession(
  socket: GameSocket,
  roomCode: string,
  playerId: string,
): void {
  socket.data.roomCode = roomCode;
  socket.data.playerId = playerId;
}

export function requireSocketSession(
  socket: GameSocket,
  roomCode: string,
): { roomCode: string; playerId: string } {
  if (
    socket.data.roomCode !== roomCode ||
    !socket.data.playerId
  ) {
    throw new RoomError("SOCKET_NOT_OWNER");
  }
  return { roomCode, playerId: socket.data.playerId };
}

export function clearSocketSession(socket: GameSocket): void {
  delete socket.data.roomCode;
  delete socket.data.playerId;
}
