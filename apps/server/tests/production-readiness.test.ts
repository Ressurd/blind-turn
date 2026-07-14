import { afterEach, describe, expect, it, vi } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@blind-turn/shared";
import { createBlindTurnServer, type BlindTurnServer } from "../src/app-server";
import {
  parseAllowedOrigins,
  parseServerEnvironment,
} from "../src/config/env";
import { createShutdownHandler } from "../src/lifecycle/graceful-shutdown";
import { noopLogger } from "../src/logging/logger";

type TestClient = Socket<ServerToClientEvents, ClientToServerEvents>;

const servers: BlindTurnServer[] = [];
const clients: TestClient[] = [];

async function startServer(options: Parameters<typeof createBlindTurnServer>[0] = {}) {
  const server = createBlindTurnServer({
    port: 0,
    logger: noopLogger,
    ...options,
  });
  servers.push(server);
  const address = await server.start();
  return { server, address };
}

function connectWithOrigin(url: string, origin: string): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const client: TestClient = createClient(url, {
      transports: ["websocket"],
      extraHeaders: { Origin: origin },
      reconnection: false,
      timeout: 1_000,
      forceNew: true,
    });
    clients.push(client);
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  for (const server of servers.splice(0)) await server.stop();
  vi.restoreAllMocks();
});

describe("production environment", () => {
  it("prefers Railway PORT over the local server port", () => {
    const environment = parseServerEnvironment({
      NODE_ENV: "production",
      PORT: "45123",
      SOCKET_SERVER_PORT: "4000",
      WEB_CLIENT_ORIGIN: "https://web.example.com",
    });
    expect(environment.port).toBe(45_123);
  });

  it("fails clearly for an invalid port or missing production origin", () => {
    expect(() =>
      parseServerEnvironment({
        NODE_ENV: "production",
        PORT: "not-a-port",
        WEB_CLIENT_ORIGIN: "https://web.example.com",
      }),
    ).toThrow(/PORT/);
    expect(() =>
      parseServerEnvironment({ NODE_ENV: "production", PORT: "4000" }),
    ).toThrow(/WEB_CLIENT_ORIGIN/);
  });

  it("normalizes a comma-separated Origin allowlist", () => {
    expect(
      parseAllowedOrigins(
        "http://localhost:3000, https://web.example.com,https://web.example.com",
      ),
    ).toEqual(["http://localhost:3000", "https://web.example.com"]);
  });
});

describe("production server lifecycle", () => {
  it("binds to 0.0.0.0 and returns a safe health payload", async () => {
    const { server, address } = await startServer();
    const created = server.roomManager.createRoom("HealthHost", "health-socket");
    const response = await fetch(`${address.url}/health`);
    const payload = await response.json() as Record<string, unknown>;
    const serialized = JSON.stringify(payload);

    expect(address.host).toBe("0.0.0.0");
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      service: "blind-turn-server",
      activeRooms: 1,
      connectedPlayers: 1,
    });
    expect(payload.uptimeSeconds).toEqual(expect.any(Number));
    expect(serialized).not.toContain(created.credentials.roomCode);
    expect(serialized).not.toContain(created.credentials.reconnectToken);
    expect(serialized).not.toContain("HealthHost");
  });

  it("allows listed Origins and rejects unlisted Origins", async () => {
    const { address } = await startServer({
      allowedOrigins: ["https://allowed.example.com"],
    });

    await expect(
      connectWithOrigin(address.url, "https://allowed.example.com"),
    ).resolves.toBeDefined();
    await expect(
      connectWithOrigin(address.url, "https://blocked.example.com"),
    ).rejects.toThrow();
  });

  it("runs SIGTERM cleanup once and removes room timers", async () => {
    const { server } = await startServer();
    const created = server.roomManager.createRoom("Host", "socket-1");
    const room = server.roomManager.getRoom(created.credentials.roomCode)!;
    server.roomManager.disconnectSocket("socket-1");
    expect(room.timers.cleanup).not.toBeNull();

    const stopSpy = vi.fn(server.stop);
    const shutdown = createShutdownHandler({
      stop: stopSpy,
      timeoutMs: 5_000,
      logger: noopLogger,
    });
    const first = shutdown("SIGTERM");
    const second = shutdown("SIGTERM");
    await Promise.all([first, second]);

    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(server.roomManager.getRoomCount()).toBe(0);
    expect(room.timers.action).toBeNull();
    expect(room.timers.nextTurn).toBeNull();
    expect(room.timers.cleanup).toBeNull();
    expect(room.timers.disconnects.size).toBe(0);
  });
});
