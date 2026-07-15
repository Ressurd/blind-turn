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

function emitInitialHands(
  io: GameServer,
  roomManager: RoomManager,
  roomCode: string,
): void {
  const room = roomManager.getRoom(roomCode);
  if (!room) return;
  for (const player of room.players) {
    if (!player.connected || !player.socketId) continue;
    const view = roomManager.getPlayerView(roomCode, player.playerId);
    if (view.initialHandOptions.length > 0) {
      io.to(player.socketId).emit("game:initial-hand-options", {
        cards: view.initialHandOptions,
      });
    }
  }
}

function emitRewardOptions(
  io: GameServer,
  roomManager: RoomManager,
  roomCode: string,
  deadlineAt: number,
): void {
  const room = roomManager.getRoom(roomCode);
  if (!room) return;
  for (const player of room.players) {
    if (!player.connected || !player.socketId) continue;
    const view = roomManager.getPlayerView(roomCode, player.playerId);
    if (view.rewardOptions.length > 0) {
      io.to(player.socketId).emit("game:reward-options", {
        cards: view.rewardOptions,
        deadlineAt,
      });
    }
  }
}

function emitDeckRemoval(
  io: GameServer,
  roomManager: RoomManager,
  roomCode: string,
  deadlineAt: number,
): void {
  const room = roomManager.getRoom(roomCode);
  if (!room) return;
  for (const player of room.players) {
    if (!player.connected || !player.socketId) continue;
    const view = roomManager.getPlayerView(roomCode, player.playerId);
    if (view.deckRemovalCandidates.length > 0) {
      io.to(player.socketId).emit("game:deck-removal-required", {
        cards: view.deckRemovalCandidates,
        deadlineAt,
      });
    }
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
      case "CHARACTER_SELECTED":
        io.to(event.roomCode).emit("room:character-selected", {
          playerId: event.playerId,
          characterId: event.characterId,
        });
        break;
      case "GAME_STARTED":
        io.to(event.roomCode).emit("game:started", {
          roundNumber: event.roundNumber,
        });
        emitInitialHands(io, roomManager, event.roomCode);
        break;
      case "QUEUE_UPDATED": {
        const room = roomManager.getRoom(event.roomCode);
        const player = room?.players.find((candidate) => candidate.playerId === event.playerId);
        if (player?.socketId) {
          io.to(player.socketId).emit("game:queue-updated", {
            queuedCards: event.queuedCards,
          });
        }
        break;
      }
      case "ROUND_SUBMISSION_STATUS":
        io.to(event.roomCode).emit("game:round-submission-status", event.payload);
        break;
      case "ROUND_LOCKED":
        io.to(event.roomCode).emit("game:round-locked", {
          roundNumber: event.roundNumber,
        });
        break;
      case "CARD_COUNTS_REVEALED":
        io.to(event.roomCode).emit("game:card-counts-revealed", {
          roundNumber: event.roundNumber,
          cardCounts: event.cardCounts,
        });
        break;
      case "ROUND_RESOLVING":
        io.to(event.roomCode).emit("game:round-resolving", {
          roundNumber: event.roundNumber,
        });
        break;
      case "ROUND_RESOLVED":
        io.to(event.roomCode).emit("game:round-resolved", event.payload);
        break;
      case "NEXT_ROUND":
        io.to(event.roomCode).emit("game:next-round", {
          roundNumber: event.roundNumber,
          actionDeadlineAt: event.actionDeadlineAt,
        });
        break;
      case "REWARD_OPTIONS":
        emitRewardOptions(io, roomManager, event.roomCode, event.deadlineAt);
        break;
      case "REWARD_SELECTED":
        io.to(event.roomCode).emit("game:reward-selected", {
          playerId: event.playerId,
        });
        break;
      case "DECK_REMOVAL_REQUIRED":
        emitDeckRemoval(io, roomManager, event.roomCode, event.deadlineAt);
        break;
      case "DECK_UPDATED": {
        const room = roomManager.getRoom(event.roomCode);
        const player = room?.players.find((candidate) => candidate.playerId === event.playerId);
        if (player?.socketId) {
          io.to(player.socketId).emit("game:deck-updated", {
            deckSize: event.deckSize,
          });
        }
        break;
      }
      case "GAME_FINISHED":
        io.to(event.roomCode).emit("game:finished", {
          result: event.result,
          totalRounds: event.totalRounds,
        });
        break;
      case "CHAT_MESSAGE":
        io.to(event.roomCode).emit("chat:message", event.message);
        break;
      case "GAME_ERROR":
        io.to(event.roomCode).emit("game:error", event.error);
        break;
    }
  });
}
