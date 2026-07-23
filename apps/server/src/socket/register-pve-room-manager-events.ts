import type { Server } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SocketData,
} from "@blind-turn/shared";
import type { PveRoomManager, PveRoomManagerEvent } from "../pve/pve-room-manager";

type GameServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

function emitViews(io: GameServer, manager: PveRoomManager, roomCode: string): void {
  const room = manager.getRoom(roomCode);
  if (!room) return;
  for (const player of room.players) {
    if (!player.connected || !player.socketId) continue;
    io.to(player.socketId).emit(
      "pve:room:state-updated",
      manager.getPlayerView(roomCode, player.playerId),
    );
  }
}

export function registerPveRoomManagerEvents(
  io: GameServer,
  manager: PveRoomManager,
): () => void {
  return manager.onEvent((event: PveRoomManagerEvent) => {
    switch (event.type) {
      case "ROOM_UPDATED":
        emitViews(io, manager, event.roomCode);
        break;
      case "TURN_RESOLVED":
        io.to(event.roomCode).emit("pve:turn-resolved", event.payload);
        break;
      case "PLAYER_DISCONNECTED":
        io.to(event.roomCode).emit("pve:player-disconnected", { playerId: event.playerId });
        break;
      case "PLAYER_RECONNECTED":
        io.to(event.roomCode).emit("pve:player-reconnected", { playerId: event.playerId });
        break;
      case "CHAT_MESSAGE":
        io.to(event.roomCode).emit("pve:chat:message", event.message);
        break;
    }
  });
}
