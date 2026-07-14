import type { Server } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SocketData,
} from "@blind-turn/shared";
import type { RoomManager, RoomManagerEvent } from "../rooms/room-manager";

type GameServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

function emitViews(io: GameServer, roomManager: RoomManager, roomCode: string): void {
  const room = roomManager.getRoom(roomCode);
  if (!room) return;
  for (const player of room.players) {
    if (!player.connected || !player.socketId) continue;
    io.to(player.socketId).emit(
      "room:state-updated",
      roomManager.getPlayerView(roomCode, player.playerId),
    );
  }
}

function emitPrivateSpeeds(
  io: GameServer,
  roomManager: RoomManager,
  roomCode: string,
): void {
  const room = roomManager.getRoom(roomCode);
  if (!room?.game) return;
  const state = room.game.getState();
  for (const player of room.players) {
    if (!player.connected || !player.socketId) continue;
    const gamePlayer = state.players.find((candidate) => candidate.id === player.playerId);
    if (gamePlayer?.speedRoll === null || gamePlayer?.speedRoll === undefined) continue;
    io.to(player.socketId).emit("game:private-speed", {
      turnNumber: state.turnNumber,
      speed: gamePlayer.speedRoll,
    });
  }
}

export function registerRoomManagerEvents(
  io: GameServer,
  roomManager: RoomManager,
): () => void {
  return roomManager.onEvent((event: RoomManagerEvent) => {
    switch (event.type) {
      case "ROOM_UPDATED":
        emitViews(io, roomManager, event.roomCode);
        break;
      case "ROOM_DELETED":
        break;
      case "PLAYER_DISCONNECTED":
        io.to(event.roomCode).emit("room:player-disconnected", {
          playerId: event.playerId,
        });
        break;
      case "PLAYER_RECONNECTED":
        io.to(event.roomCode).emit("room:player-reconnected", {
          playerId: event.playerId,
        });
        break;
      case "GAME_STARTED":
        io.to(event.roomCode).emit("game:started", {
          turnNumber: event.turnNumber,
        });
        emitPrivateSpeeds(io, roomManager, event.roomCode);
        break;
      case "SUBMISSION_STATUS":
        io.to(event.roomCode).emit("game:submission-status", event.payload);
        break;
      case "TURN_RESOLVING":
        io.to(event.roomCode).emit("game:turn-resolving", {
          turnNumber: event.turnNumber,
        });
        break;
      case "TURN_RESOLVED":
        io.to(event.roomCode).emit("game:turn-resolved", event.payload);
        break;
      case "NEXT_TURN":
        io.to(event.roomCode).emit("game:next-turn", {
          turnNumber: event.turnNumber,
          actionDeadlineAt: event.actionDeadlineAt,
        });
        emitPrivateSpeeds(io, roomManager, event.roomCode);
        break;
      case "GAME_FINISHED":
        io.to(event.roomCode).emit("game:finished", {
          result: event.result,
          totalTurns: event.totalTurns,
        });
        break;
      case "GAME_ERROR":
        io.to(event.roomCode).emit("game:error", event.error);
        break;
    }
  });
}
