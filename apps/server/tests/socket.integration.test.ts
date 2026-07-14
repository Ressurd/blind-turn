import { afterEach, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  CreateRoomResult,
  JoinRoomResult,
  ServerToClientEvents,
  SocketAck,
  TurnResolvedPayload,
} from "@blind-turn/shared";
import { createBlindTurnServer, type BlindTurnServer } from "../src/app-server";

type TestClient = Socket<ServerToClientEvents, ClientToServerEvents>;

const servers: BlindTurnServer[] = [];
const clients: TestClient[] = [];

async function startServer() {
  const server = createBlindTurnServer({ port: 0 });
  servers.push(server);
  const address = await server.start();
  return { server, url: address.url };
}

function connectClient(url: string): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const client: TestClient = createClient(url, { transports: ["websocket"] });
    clients.push(client);
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

function onceEvent<K extends keyof ServerToClientEvents>(
  client: TestClient,
  event: K,
): Promise<Parameters<ServerToClientEvents[K]>[0]> {
  return new Promise((resolve) => {
    client.once(
      event,
      ((payload: Parameters<ServerToClientEvents[K]>[0]) => resolve(payload)) as any,
    );
  });
}

function createRoom(client: TestClient, nickname: string): Promise<CreateRoomResult> {
  return new Promise((resolve, reject) => {
    client.emit("room:create", { nickname }, (response: SocketAck<CreateRoomResult>) => {
      if (response.ok) resolve(response.data);
      else reject(new Error(response.error.code));
    });
  });
}

function joinRoom(
  client: TestClient,
  roomCode: string,
  nickname: string,
): Promise<JoinRoomResult> {
  return new Promise((resolve, reject) => {
    client.emit("room:join", { roomCode, nickname }, (response: SocketAck<JoinRoomResult>) => {
      if (response.ok) resolve(response.data);
      else reject(new Error(response.error.code));
    });
  });
}

function ready(client: TestClient, roomCode: string): Promise<void> {
  return new Promise((resolve, reject) => {
    client.emit("room:set-ready", { roomCode, ready: true }, (response) => {
      if (response.ok) resolve();
      else reject(new Error(response.error.code));
    });
  });
}

function startGame(client: TestClient, roomCode: string): Promise<void> {
  return new Promise((resolve, reject) => {
    client.emit("room:start-game", { roomCode }, (response) => {
      if (response.ok) resolve();
      else reject(new Error(response.error.code));
    });
  });
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  for (const server of servers.splice(0)) await server.stop();
});

describe("Socket.IO multiplayer flow", () => {
  it("lets two clients join the same room and start a game", async () => {
    const { url } = await startServer();
    const hostClient = await connectClient(url);
    const guestClient = await connectClient(url);
    const host = await createRoom(hostClient, "Host");
    const guest = await joinRoom(guestClient, host.credentials.roomCode, "Guest");
    expect(guest.view.players).toHaveLength(2);

    await ready(hostClient, host.credentials.roomCode);
    await ready(guestClient, host.credentials.roomCode);
    const hostStarted = onceEvent(hostClient, "game:started");
    const guestStarted = onceEvent(guestClient, "game:started");
    await startGame(hostClient, host.credentials.roomCode);

    await expect(hostStarted).resolves.toEqual({ turnNumber: 1 });
    await expect(guestStarted).resolves.toEqual({ turnNumber: 1 });
  });

  it("delivers the identical resolved turn to both clients", async () => {
    const { url } = await startServer();
    const hostClient = await connectClient(url);
    const guestClient = await connectClient(url);
    const host = await createRoom(hostClient, "Host");
    const guest = await joinRoom(guestClient, host.credentials.roomCode, "Guest");
    await ready(hostClient, host.credentials.roomCode);
    await ready(guestClient, host.credentials.roomCode);
    await startGame(hostClient, host.credentials.roomCode);

    const hostResult = onceEvent(hostClient, "game:turn-resolved") as Promise<TurnResolvedPayload>;
    const guestResult = onceEvent(guestClient, "game:turn-resolved") as Promise<TurnResolvedPayload>;
    hostClient.emit(
      "game:submit-action",
      {
        roomCode: host.credentials.roomCode,
        turnNumber: 1,
        action: { type: "ATTACK", targetPlayerId: guest.credentials.playerId },
      },
      () => undefined,
    );
    guestClient.emit(
      "game:submit-action",
      {
        roomCode: host.credentials.roomCode,
        turnNumber: 1,
        action: { type: "DEFEND" },
      },
      () => undefined,
    );

    const [hostPayload, guestPayload] = await Promise.all([hostResult, guestResult]);
    expect(hostPayload).toEqual(guestPayload);
    expect(
      hostPayload.events.some(
        (event) => (event as { type: string }).type === "SPEED_ROLLED",
      ),
    ).toBe(false);
  });

  it("restores private state and the action deadline after reconnect", async () => {
    const { url } = await startServer();
    const hostClient = await connectClient(url);
    const guestClient = await connectClient(url);
    const host = await createRoom(hostClient, "Host");
    const guest = await joinRoom(guestClient, host.credentials.roomCode, "Guest");
    await ready(hostClient, host.credentials.roomCode);
    await ready(guestClient, host.credentials.roomCode);
    await startGame(hostClient, host.credentials.roomCode);

    await new Promise<void>((resolve, reject) => {
      hostClient.emit(
        "game:submit-action",
        {
          roomCode: host.credentials.roomCode,
          turnNumber: 1,
          action: { type: "ATTACK", targetPlayerId: guest.credentials.playerId },
        },
        (response) => response.ok ? resolve() : reject(new Error(response.error.code)),
      );
    });
    const before = hostClient.connected;
    expect(before).toBe(true);
    hostClient.disconnect();

    const reconnectedClient = await connectClient(url);
    const restored = await new Promise<CreateRoomResult>((resolve, reject) => {
      reconnectedClient.emit("room:reconnect", host.credentials, (response) => {
        if (response.ok) resolve(response.data);
        else reject(new Error(response.error.code));
      });
    });

    expect(restored.view.mySpeed).toEqual(expect.any(Number));
    expect(restored.view.mySubmittedAction).toEqual({
      type: "ATTACK",
      targetPlayerId: guest.credentials.playerId,
    });
    expect(restored.view.actionDeadlineAt).toEqual(expect.any(Number));
    expect(restored.view.players.find(
      (player) => player.playerId === host.credentials.playerId,
    )?.submitted).toBe(true);
  });

  it("returns ROOM_SESSION_EXPIRED for a missing reconnect room", async () => {
    const { url } = await startServer();
    const client = await connectClient(url);
    const response = await new Promise<SocketAck<CreateRoomResult>>((resolve) => {
      client.emit(
        "room:reconnect",
        {
          roomCode: "ABC234",
          playerId: "missing-player",
          reconnectToken: "x".repeat(40),
        },
        resolve,
      );
    });

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe("ROOM_SESSION_EXPIRED");
      expect(response.error.recoverable).toBe(false);
    }
  });
});
