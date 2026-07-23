import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SocketData,
} from "@blind-turn/shared";
import {
  noopLogger,
  type AppLogger,
} from "./logging/logger";
import { RoomManager } from "./rooms/room-manager";
import { PveRoomManager } from "./pve/pve-room-manager";
import { registerChatEvents } from "./socket/register-chat-events";
import { registerGameEvents } from "./socket/register-game-events";
import { registerRoomEvents } from "./socket/register-room-events";
import { registerRoomManagerEvents } from "./socket/register-room-manager-events";
import { registerPveEvents } from "./socket/register-pve-events";
import { registerPveRoomManagerEvents } from "./socket/register-pve-room-manager-events";
import type { GameSocket } from "./socket/socket-session";

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:3000"];

export type BlindTurnServerOptions = {
  port?: number;
  host?: string;
  allowedOrigins?: string[];
  roomManager?: RoomManager;
  pveRoomManager?: PveRoomManager;
  logger?: AppLogger;
};

export type BlindTurnServer = {
  io: Server<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
  >;
  httpServer: HttpServer;
  roomManager: RoomManager;
  pveRoomManager: PveRoomManager;
  start: () => Promise<{ host: string; port: number; url: string }>;
  stop: () => Promise<void>;
};

export function createBlindTurnServer(
  options: BlindTurnServerOptions = {},
): BlindTurnServer {
  const logger = options.logger ?? noopLogger;
  const allowedOrigins = options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS;
  const roomManager = options.roomManager ?? new RoomManager({ logger });
  const pveRoomManager = options.pveRoomManager ?? new PveRoomManager({
    logger,
    roomCodeExists: (roomCode) => Boolean(roomManager.getRoom(roomCode)),
  });
  const host = options.host ?? DEFAULT_HOST;
  let lifecycle: "created" | "ready" | "stopping" | "stopped" = "created";
  let startedAt = 0;
  let stopPromise: Promise<void> | null = null;

  const httpServer = createHttpServer((request, response) => {
    if (request.url === "/health" && request.method === "GET") {
      const ready = lifecycle === "ready";
      response.writeHead(ready ? 200 : 503, {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({
        ok: ready,
        service: "blind-turn-server",
        uptimeSeconds: ready ? Math.max(0, Math.floor((Date.now() - startedAt) / 1_000)) : 0,
        activeRooms: roomManager.getRoomCount() + pveRoomManager.getRoomCount(),
        connectedPlayers: roomManager.getConnectedPlayerCount() + pveRoomManager.getConnectedPlayerCount(),
      }));
      return;
    }
    response.writeHead(404);
    response.end();
  });

  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
  >(httpServer, {
    cors: {
      origin: allowedOrigins,
      methods: ["GET", "POST"],
      credentials: true,
    },
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      const allowed = !origin || allowedOrigins.includes(origin);
      if (!allowed) {
        logger.warn("socket_origin_rejected", {
          origin,
          errorCode: "ORIGIN_NOT_ALLOWED",
        });
      }
      callback(allowed ? null : "Origin is not allowed", allowed);
    },
  });

  const unsubscribe = registerRoomManagerEvents(io, roomManager);
  const unsubscribePve = registerPveRoomManagerEvents(io, pveRoomManager);
  io.on("connection", (socket: GameSocket) => {
    logger.info("socket_connected", {
      socketId: socket.id.slice(0, 8),
      origin: socket.handshake.headers.origin ?? null,
      transport: socket.conn.transport.name,
    });
    registerRoomEvents(socket, roomManager, logger);
    registerGameEvents(socket, roomManager, logger);
    registerChatEvents(socket, roomManager, logger);
    registerPveEvents(socket, pveRoomManager, logger);
    socket.on("disconnect", (reason) => {
      roomManager.disconnectSocket(socket.id);
      pveRoomManager.disconnectSocket(socket.id);
      logger.info("socket_disconnected", {
        socketId: socket.id.slice(0, 8),
        reason,
      });
    });
  });

  return {
    io,
    httpServer,
    roomManager,
    pveRoomManager,
    start: () =>
      new Promise((resolve, reject) => {
        if (lifecycle !== "created") {
          reject(new Error(`서버를 시작할 수 없는 상태입니다: ${lifecycle}`));
          return;
        }
        httpServer.once("error", reject);
        httpServer.listen(options.port ?? 4000, host, () => {
          httpServer.off("error", reject);
          const address = httpServer.address();
          const port = typeof address === "object" && address ? address.port : 0;
          lifecycle = "ready";
          startedAt = Date.now();
          resolve({ host, port, url: `http://localhost:${port}` });
        });
      }),
    stop: () => {
      if (stopPromise) return stopPromise;
      lifecycle = "stopping";
      unsubscribe();
      unsubscribePve();
      roomManager.destroy();
      pveRoomManager.destroy();
      stopPromise = new Promise((resolve) => {
        io.close(() => {
          lifecycle = "stopped";
          resolve();
        });
      });
      return stopPromise;
    },
  };
}
