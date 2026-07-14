import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@blind-turn/shared";
import {
  SOCKET_CONFIGURATION_ERROR,
  SOCKET_SERVER_URL,
  USING_DEFAULT_SOCKET_URL,
} from "../../config/public-env";

export type GameClientSocket = Socket<
  ServerToClientEvents,
  ClientToServerEvents
>;

export {
  SOCKET_CONFIGURATION_ERROR,
  SOCKET_SERVER_URL,
  USING_DEFAULT_SOCKET_URL,
};

let sharedSocket: GameClientSocket | null = null;

export function getGameSocket(): GameClientSocket | null {
  if (!SOCKET_SERVER_URL) return null;
  if (!sharedSocket) {
    sharedSocket = io(SOCKET_SERVER_URL, {
      autoConnect: false,
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5_000,
      timeout: 10_000,
    });
  }
  return sharedSocket;
}
