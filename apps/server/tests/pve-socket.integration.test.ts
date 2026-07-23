import { afterEach, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import {
  type ClientToServerEvents,
  type PveCharacterId,
  type PveRoomIdentityResult,
  type PveTurnResolvedPayload,
  type ServerToClientEvents,
  type SocketAck,
} from "@blind-turn/shared";
import { createBlindTurnServer, type BlindTurnServer } from "../src/app-server";

type TestClient = Socket<ServerToClientEvents, ClientToServerEvents>;
const clients: TestClient[] = [];
const servers: BlindTurnServer[] = [];

function connect(url: string): Promise<TestClient> {
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

function emitAck<T>(operation: (done: (response: SocketAck<T>) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    operation((response) => response.ok ? resolve(response.data) : reject(new Error(response.error.code)));
  });
}

function onceResolved(client: TestClient): Promise<PveTurnResolvedPayload> {
  return new Promise((resolve) => client.once("pve:turn-resolved", resolve));
}

async function assignCharacters(
  client: TestClient,
  roomCode: string,
  characterIds: readonly PveCharacterId[],
): Promise<void> {
  for (const characterId of characterIds) {
    await emitAck((done) => client.emit("pve:room:select-character", {
      roomCode,
      characterId,
    }, done));
  }
}

async function fillPassPlans(
  client: TestClient,
  roomCode: string,
  characterIds: readonly PveCharacterId[],
): Promise<void> {
  for (const characterId of characterIds) {
    for (const beat of [1, 2, 3] as const) {
      await emitAck((done) => client.emit("pve:plan:set-slot", {
        roomCode,
        turnNumber: 1,
        characterId,
        beat,
        action: { actionId: "PASS" },
      }, done));
    }
  }
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  for (const server of servers.splice(0)) await server.stop();
});

describe("online PvE Socket.IO flow", () => {
  it("resolves exactly once for two players controlling two characters each", async () => {
    const server = createBlindTurnServer({ port: 0 });
    servers.push(server);
    const { url } = await server.start();
    const [hostClient, guestClient] = await Promise.all([connect(url), connect(url)]);
    const host = await emitAck<PveRoomIdentityResult>((done) =>
      hostClient!.emit("pve:room:create", { nickname: "Host" }, done));
    const guest = await emitAck<PveRoomIdentityResult>((done) =>
      guestClient!.emit("pve:room:join", {
        roomCode: host.credentials.roomCode,
        nickname: "Guest",
      }, done));

    const assignments: readonly (readonly PveCharacterId[])[] = [
      ["WARRIOR", "PRIEST"],
      ["ARCHER", "MAGE"],
    ];
    await assignCharacters(hostClient!, host.credentials.roomCode, assignments[0]!);
    await assignCharacters(guestClient!, host.credentials.roomCode, assignments[1]!);
    for (const client of [hostClient!, guestClient!]) {
      await emitAck((done) => client.emit("pve:room:set-ready", {
        roomCode: host.credentials.roomCode,
        ready: true,
      }, done));
    }
    await emitAck((done) => hostClient!.emit("pve:room:start", {
      roomCode: host.credentials.roomCode,
    }, done));

    await fillPassPlans(hostClient!, host.credentials.roomCode, assignments[0]!);
    await fillPassPlans(guestClient!, host.credentials.roomCode, assignments[1]!);
    const received = [onceResolved(hostClient!), onceResolved(guestClient!)];
    await emitAck((done) => hostClient!.emit("pve:plan:set-confirmed", {
      roomCode: host.credentials.roomCode,
      turnNumber: 1,
      confirmed: true,
    }, done));
    expect(server.pveRoomManager.getRoom(host.credentials.roomCode)?.phase).toBe("PLANNING");
    expect(server.pveRoomManager.getRoom(host.credentials.roomCode)?.confirmedPlayerIds.size).toBe(1);
    await emitAck((done) => guestClient!.emit("pve:plan:set-confirmed", {
      roomCode: host.credentials.roomCode,
      turnNumber: 1,
      confirmed: true,
    }, done));

    const payloads = await Promise.all(received);
    expect(payloads[1]!.resolution.events).toEqual(payloads[0]!.resolution.events);
    expect(server.pveRoomManager.getRoom(host.credentials.roomCode)?.history).toHaveLength(1);
    expect(server.pveRoomManager.getRoom(host.credentials.roomCode)?.phase).toBe("RESOLVING");

    for (const client of [hostClient!, guestClient!]) {
      await emitAck((done) => client.emit("pve:playback-finished", {
        roomCode: host.credentials.roomCode,
        turnNumber: 1,
      }, done));
    }
    expect(server.pveRoomManager.getRoom(host.credentials.roomCode)?.turnNumber).toBe(2);
    expect(server.pveRoomManager.getRoom(host.credentials.roomCode)?.phase).toBe("PLANNING");
    expect([host, guest]).toHaveLength(2);
  });
});
