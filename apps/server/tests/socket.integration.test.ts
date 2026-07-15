import { afterEach, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import type {
  CharacterClassId,
  ClientToServerEvents,
  CreateRoomResult,
  JoinRoomResult,
  ServerToClientEvents,
  SocketAck,
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
    const client: TestClient = createClient(url, {
      transports: ["websocket"],
      reconnection: false,
      forceNew: true,
    });
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
    client.once(event, ((payload: Parameters<ServerToClientEvents[K]>[0]) => resolve(payload)) as never);
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

function joinRoom(client: TestClient, roomCode: string, nickname: string): Promise<JoinRoomResult> {
  return new Promise((resolve, reject) => {
    client.emit("room:join", { roomCode, nickname }, (response: SocketAck<JoinRoomResult>) => {
      if (response.ok) resolve(response.data);
      else reject(new Error(response.error.code));
    });
  });
}

function selectCharacter(client: TestClient, roomCode: string, characterId: CharacterClassId): Promise<void> {
  return new Promise((resolve, reject) => {
    client.emit("room:select-character", { roomCode, characterId }, (response) => {
      if (response.ok) resolve();
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

function confirmRound(client: TestClient, roomCode: string, roundNumber: number): Promise<void> {
  return new Promise((resolve, reject) => {
    client.emit("game:confirm-round", { roomCode, roundNumber }, (response) => {
      if (response.ok) resolve();
      else reject(new Error(response.error.code));
    });
  });
}

async function setupGame() {
  const { server, url } = await startServer();
  const hostClient = await connectClient(url);
  const guestClient = await connectClient(url);
  const host = await createRoom(hostClient, "Host");
  const guest = await joinRoom(guestClient, host.credentials.roomCode, "Guest");
  await selectCharacter(hostClient, host.credentials.roomCode, "DUELIST");
  await selectCharacter(guestClient, host.credentials.roomCode, "GUARDIAN");
  await ready(hostClient, host.credentials.roomCode);
  await ready(guestClient, host.credentials.roomCode);
  return { server, url, hostClient, guestClient, host, guest, roomCode: host.credentials.roomCode };
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  for (const server of servers.splice(0)) await server.stop();
});

describe("Socket.IO V2 multiplayer flow", () => {
  it("lets two clients select characters and start round 1", async () => {
    const setup = await setupGame();
    const hostStarted = onceEvent(setup.hostClient, "game:started");
    const guestStarted = onceEvent(setup.guestClient, "game:started");
    await startGame(setup.hostClient, setup.roomCode);
    await expect(hostStarted).resolves.toEqual({ roundNumber: 1 });
    await expect(guestStarted).resolves.toEqual({ roundNumber: 1 });
    expect(setup.server.roomManager.getRoom(setup.roomCode)?.phase).toBe("SELECTING_CARDS");
  });

  it("keeps queued cards private and delivers one identical resolved round", async () => {
    const setup = await setupGame();
    const hostState = onceEvent(setup.hostClient, "room:state-updated");
    await startGame(setup.hostClient, setup.roomCode);
    const hostView = await hostState;
    const card = hostView.myHand[0]!;
    const guestId = setup.guest.credentials.playerId;
    await new Promise<void>((resolve, reject) => {
      setup.hostClient.emit("game:queue-card", {
        roomCode: setup.roomCode,
        roundNumber: 1,
        cardInstanceId: card.instanceId,
        ...(card.definition.targetType === "ENEMY" ? { targetPlayerId: guestId } : {}),
        additionalSelection: null,
      }, (response) => response.ok ? resolve() : reject(new Error(response.error.code)));
    });

    const guestPrivateView = setup.server.roomManager.getPlayerView(
      setup.roomCode,
      setup.guest.credentials.playerId,
    );
    expect(JSON.stringify(guestPrivateView)).not.toContain(card.instanceId);
    expect(guestPrivateView.players.find((player) => player.playerId === setup.host.credentials.playerId)?.usedCardCount).toBeNull();

    const hostResolved = onceEvent(setup.hostClient, "game:round-resolved");
    const guestResolved = onceEvent(setup.guestClient, "game:round-resolved");
    await confirmRound(setup.hostClient, setup.roomCode, 1);
    await confirmRound(setup.guestClient, setup.roomCode, 1);
    const [first, second] = await Promise.all([hostResolved, guestResolved]);
    expect(first).toEqual(second);
    expect(first.roundNumber).toBe(1);
    for (const event of first.events.filter((entry) => entry.type === "CARD_DRAWN")) {
      expect(event).not.toHaveProperty("cardId");
      expect(event).not.toHaveProperty("cardInstanceId");
    }
  });

  it("broadcasts server-authored same-room chat without accepting identity fields", async () => {
    const setup = await setupGame();
    const hostMessage = onceEvent(setup.hostClient, "chat:message");
    const guestMessage = onceEvent(setup.guestClient, "chat:message");
    await new Promise<void>((resolve, reject) => {
      setup.guestClient.emit("chat:send", {
        roomCode: setup.roomCode,
        message: "  준비   완료!  ",
      }, (response) => response.ok ? resolve() : reject(new Error(response.error.code)));
    });
    const [first, second] = await Promise.all([hostMessage, guestMessage]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      playerId: setup.guest.credentials.playerId,
      nickname: "Guest",
      message: "준비 완료!",
      kind: "PLAYER",
    });
  });

  it("restores the same room and private hand after reconnect", async () => {
    const setup = await setupGame();
    const hostState = onceEvent(setup.hostClient, "room:state-updated");
    await startGame(setup.hostClient, setup.roomCode);
    const before = await hostState;
    setup.hostClient.disconnect();
    const replacement = await connectClient(setup.url);
    const restored = await new Promise<CreateRoomResult>((resolve, reject) => {
      replacement.emit("room:reconnect", setup.host.credentials, (response) => {
        if (response.ok) resolve(response.data);
        else reject(new Error(response.error.code));
      });
    });
    expect(restored.view.myHand).toEqual(before.myHand);
    expect(restored.view.roundNumber).toBe(1);
  });
});
