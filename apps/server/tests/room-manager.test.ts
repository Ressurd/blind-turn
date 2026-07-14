import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_HP,
  NORMAL_DAMAGE,
  SeededRandomSource,
  type TurnResolvedPayload,
} from "@blind-turn/shared";
import { createPublicEvents } from "../src/game/event-player";
import { createRoomCode, ROOM_CODE_ALPHABET } from "../src/rooms/room-code";
import { RoomError } from "../src/rooms/room-error";
import {
  RoomManager,
  type RoomManagerEvent,
  type RoomManagerOptions,
} from "../src/rooms/room-manager";

const managers: RoomManager[] = [];

function makeManager(overrides: Partial<RoomManagerOptions> = {}): RoomManager {
  let playerIndex = 0;
  let codeIndex = 0;
  const codes = ["ABC234", "DEF567", "GHJ789", "KMN234"];
  const manager = new RoomManager({
    generateRoomCode: () => codes[codeIndex++] ?? `ZZZ${codeIndex}99`.slice(0, 6),
    createPlayerId: () => `player-${++playerIndex}`,
    createReconnectToken: () => `token-${playerIndex}-${"x".repeat(32)}`,
    randomSourceFactory: () => new SeededRandomSource(42),
    actionTimeoutMs: 30_000,
    eventsFinishTimeoutMs: 8_000,
    disconnectGraceMs: 30_000,
    ...overrides,
  });
  managers.push(manager);
  return manager;
}

function addTwoPlayers(manager: RoomManager) {
  const host = manager.createRoom("Host", "socket-1");
  const guest = manager.joinRoom(host.credentials.roomCode, "Guest", "socket-2");
  return { host, guest, roomCode: host.credentials.roomCode };
}

function readyTwoPlayers(
  manager: RoomManager,
  setup = addTwoPlayers(manager),
) {
  manager.setReady(
    setup.roomCode,
    setup.host.credentials.playerId,
    "socket-1",
    true,
  );
  manager.setReady(
    setup.roomCode,
    setup.guest.credentials.playerId,
    "socket-2",
    true,
  );
  return setup;
}

function startTwoPlayerGame(manager: RoomManager) {
  const setup = readyTwoPlayers(manager);
  manager.startGame(
    setup.roomCode,
    setup.host.credentials.playerId,
    "socket-1",
  );
  return setup;
}

function expectRoomError(operation: () => unknown, code: RoomError["code"]): void {
  try {
    operation();
    throw new Error("Expected operation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(RoomError);
    expect((error as RoomError).code).toBe(code);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-14T12:00:00Z"));
});

afterEach(() => {
  for (const manager of managers.splice(0)) manager.destroy();
  vi.useRealTimers();
});

describe("room creation and lobby rules", () => {
  it("creates a six-character code from the non-confusing alphabet", () => {
    let cursor = 0;
    const code = createRoomCode(() => (cursor++ % ROOM_CODE_ALPHABET.length) / ROOM_CODE_ALPHABET.length);
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
  });

  it("retries when a generated room code already exists", () => {
    const codes = ["ABC234", "ABC234", "DEF567"];
    const manager = makeManager({ generateRoomCode: () => codes.shift()! });
    const first = manager.createRoom("A", "socket-a");
    const second = manager.createRoom("B", "socket-b");
    expect(first.credentials.roomCode).toBe("ABC234");
    expect(second.credentials.roomCode).toBe("DEF567");
  });

  it("allows at most six players", () => {
    const manager = makeManager();
    const host = manager.createRoom("P1", "s1");
    for (let index = 2; index <= 6; index += 1) {
      manager.joinRoom(host.credentials.roomCode, `P${index}`, `s${index}`);
    }
    expect(manager.getRoom(host.credentials.roomCode)?.players).toHaveLength(6);
    expectRoomError(
      () => manager.joinRoom(host.credentials.roomCode, "P7", "s7"),
      "ROOM_FULL",
    );
  });

  it("rejects duplicate nicknames case-insensitively", () => {
    const manager = makeManager();
    const host = manager.createRoom("Raven", "s1");
    expectRoomError(
      () => manager.joinRoom(host.credentials.roomCode, "raven", "s2"),
      "NICKNAME_ALREADY_USED",
    );
  });

  it("rejects invalid nicknames", () => {
    const manager = makeManager();
    expectRoomError(() => manager.createRoom("   ", "s1"), "INVALID_NICKNAME");
    expectRoomError(
      () => manager.createRoom("1234567890123", "s1"),
      "INVALID_NICKNAME",
    );
  });

  it("does not start with fewer than two players", () => {
    const manager = makeManager();
    const host = manager.createRoom("Host", "s1");
    manager.setReady(host.credentials.roomCode, host.credentials.playerId, "s1", true);
    expectRoomError(
      () => manager.startGame(host.credentials.roomCode, host.credentials.playerId, "s1"),
      "NOT_ENOUGH_PLAYERS",
    );
  });

  it("requires every player to be connected and ready", () => {
    const manager = makeManager();
    const setup = addTwoPlayers(manager);
    manager.setReady(setup.roomCode, setup.host.credentials.playerId, "socket-1", true);
    expectRoomError(
      () => manager.startGame(setup.roomCode, setup.host.credentials.playerId, "socket-1"),
      "NOT_ALL_PLAYERS_READY",
    );
  });

  it("allows only the host to start the game", () => {
    const manager = makeManager();
    const setup = readyTwoPlayers(manager);
    expectRoomError(
      () => manager.startGame(setup.roomCode, setup.guest.credentials.playerId, "socket-2"),
      "NOT_ROOM_HOST",
    );
  });

  it("rejects joining after the game starts", () => {
    const manager = makeManager();
    const setup = startTwoPlayerGame(manager);
    expectRoomError(
      () => manager.joinRoom(setup.roomCode, "Late", "socket-3"),
      "GAME_ALREADY_STARTED",
    );
  });
});

describe("private state and action validation", () => {
  it("shows each viewer only their own speed", () => {
    const manager = makeManager();
    const setup = startTwoPlayerGame(manager);
    const hostView = manager.getPlayerView(setup.roomCode, setup.host.credentials.playerId);
    const guestView = manager.getPlayerView(setup.roomCode, setup.guest.credentials.playerId);
    expect(hostView.mySpeed).toEqual(expect.any(Number));
    expect(guestView.mySpeed).toEqual(expect.any(Number));
    expect(hostView.players.every((player) => !("speedRoll" in player))).toBe(true);
  });

  it("does not expose another player's selected action", () => {
    const manager = makeManager();
    const setup = startTwoPlayerGame(manager);
    manager.submitAction(
      setup.roomCode,
      setup.host.credentials.playerId,
      "socket-1",
      1,
      { type: "ATTACK", targetPlayerId: setup.guest.credentials.playerId },
    );
    const hostView = manager.getPlayerView(setup.roomCode, setup.host.credentials.playerId);
    const guestView = manager.getPlayerView(setup.roomCode, setup.guest.credentials.playerId);
    expect(hostView.mySubmittedAction).toEqual({
      type: "ATTACK",
      targetPlayerId: setup.guest.credentials.playerId,
    });
    expect(guestView.mySubmittedAction).toBeNull();
    expect(guestView.players.find((player) => player.playerId === setup.host.credentials.playerId)?.submitted).toBe(true);
  });

  it("accepts a valid action", () => {
    const manager = makeManager();
    const setup = startTwoPlayerGame(manager);
    expect(() =>
      manager.submitAction(
        setup.roomCode,
        setup.host.credentials.playerId,
        "socket-1",
        1,
        { type: "DEFEND" },
      ),
    ).not.toThrow();
  });

  it("rejects an invalid target", () => {
    const manager = makeManager();
    const setup = startTwoPlayerGame(manager);
    expectRoomError(
      () =>
        manager.submitAction(
          setup.roomCode,
          setup.host.credentials.playerId,
          "socket-1",
          1,
          { type: "ATTACK", targetPlayerId: "missing" },
        ),
      "INVALID_TARGET",
    );
  });

  it("rejects actions from a dead player", () => {
    const manager = makeManager();
    const setup = startTwoPlayerGame(manager);
    const room = manager.getRoom(setup.roomCode)!;
    const player = room.game!.getState().players.find(
      (candidate) => candidate.id === setup.host.credentials.playerId,
    )!;
    player.alive = false;
    player.hp = 0;
    expectRoomError(
      () =>
        manager.submitAction(
          setup.roomCode,
          setup.host.credentials.playerId,
          "socket-1",
          1,
          { type: "PASS" },
        ),
      "PLAYER_DEAD",
    );
  });

  it("rejects duplicate action submissions", () => {
    const manager = makeManager();
    const setup = startTwoPlayerGame(manager);
    manager.submitAction(
      setup.roomCode,
      setup.host.credentials.playerId,
      "socket-1",
      1,
      { type: "DEFEND" },
    );
    expectRoomError(
      () =>
        manager.submitAction(
          setup.roomCode,
          setup.host.credentials.playerId,
          "socket-1",
          1,
          { type: "EVADE" },
        ),
      "ACTION_ALREADY_SUBMITTED",
    );
  });

  it("rejects a mismatched turn number", () => {
    const manager = makeManager();
    const setup = startTwoPlayerGame(manager);
    expectRoomError(
      () =>
        manager.submitAction(
          setup.roomCode,
          setup.host.credentials.playerId,
          "socket-1",
          99,
          { type: "DEFEND" },
        ),
      "TURN_NUMBER_MISMATCH",
    );
  });

  it("blocks a socket from impersonating another player", () => {
    const manager = makeManager();
    const setup = startTwoPlayerGame(manager);
    expectRoomError(
      () =>
        manager.submitAction(
          setup.roomCode,
          setup.host.credentials.playerId,
          "socket-2",
          1,
          { type: "DEFEND" },
        ),
      "SOCKET_NOT_OWNER",
    );
  });
});

describe("turn resolution and timeout safety", () => {
  it("resolves exactly once when all players submit", () => {
    const manager = makeManager();
    const setup = startTwoPlayerGame(manager);
    let resolvedCount = 0;
    manager.onEvent((event) => {
      if (event.type === "TURN_RESOLVED") resolvedCount += 1;
    });
    manager.submitAction(setup.roomCode, setup.host.credentials.playerId, "socket-1", 1, { type: "DEFEND" });
    manager.submitAction(setup.roomCode, setup.guest.credentials.playerId, "socket-2", 1, { type: "EVADE" });
    manager.handleActionTimeout(setup.roomCode, 1);
    expect(resolvedCount).toBe(1);
  });

  it("does not double-resolve when timeout races the final submission", () => {
    const manager = makeManager();
    const setup = startTwoPlayerGame(manager);
    const events: RoomManagerEvent[] = [];
    manager.onEvent((event) => events.push(event));
    manager.submitAction(setup.roomCode, setup.host.credentials.playerId, "socket-1", 1, { type: "DEFEND" });
    manager.submitAction(setup.roomCode, setup.guest.credentials.playerId, "socket-2", 1, { type: "EVADE" });
    manager.handleActionTimeout(setup.roomCode, 1);
    expect(events.filter((event) => event.type === "TURN_RESOLVED")).toHaveLength(1);
  });

  it("uses PASS for players who miss the action deadline", () => {
    const manager = makeManager();
    const setup = startTwoPlayerGame(manager);
    let resolution: TurnResolvedPayload | null = null;
    manager.onEvent((event) => {
      if (event.type === "TURN_RESOLVED") resolution = event.payload;
    });
    manager.submitAction(setup.roomCode, setup.host.credentials.playerId, "socket-1", 1, { type: "DEFEND" });
    manager.handleActionTimeout(setup.roomCode, 1);
    expect(
      (resolution as TurnResolvedPayload | null)?.events,
    ).toContainEqual({
      type: "ACTION_STARTED",
      playerId: setup.guest.credentials.playerId,
      actionType: "PASS",
    });
  });

  it("broadcast payload never contains private speed events", () => {
    const publicEvents = createPublicEvents([
      { type: "TURN_STARTED", turnNumber: 1 },
      { type: "SPEED_ROLLED", playerId: "p1", speed: 10 },
    ]);
    expect(publicEvents).toEqual([{ type: "TURN_STARTED", turnNumber: 1 }]);
  });

  it("produces one shared public result for every player view", () => {
    const manager = makeManager();
    const setup = startTwoPlayerGame(manager);
    manager.submitAction(setup.roomCode, setup.host.credentials.playerId, "socket-1", 1, { type: "DEFEND" });
    manager.submitAction(setup.roomCode, setup.guest.credentials.playerId, "socket-2", 1, { type: "EVADE" });
    const hostView = manager.getPlayerView(setup.roomCode, setup.host.credentials.playerId);
    const guestView = manager.getPlayerView(setup.roomCode, setup.guest.credentials.playerId);
    expect(hostView.players.map(({ playerId, hp, alive }) => ({ playerId, hp, alive }))).toEqual(
      guestView.players.map(({ playerId, hp, alive }) => ({ playerId, hp, alive })),
    );
  });
});

describe("reconnection, host transfer, finish, and rematch", () => {
  it("restores a session when the reconnect token matches", () => {
    const manager = makeManager();
    const setup = startTwoPlayerGame(manager);
    manager.disconnectSocket("socket-1");
    const restored = manager.reconnectRoom(setup.host.credentials, "socket-new");
    expect(restored.view.selfPlayerId).toBe(setup.host.credentials.playerId);
    expect(restored.view.mySpeed).toEqual(expect.any(Number));
    expect(manager.getRoom(setup.roomCode)?.players[0]?.connected).toBe(true);
  });

  it("rejects an invalid reconnect token", () => {
    const manager = makeManager();
    const setup = addTwoPlayers(manager);
    expectRoomError(
      () =>
        manager.reconnectRoom(
          { ...setup.host.credentials, reconnectToken: "wrong-token" },
          "socket-new",
        ),
      "INVALID_RECONNECT_TOKEN",
    );
  });

  it("reports an expired session when its room no longer exists", () => {
    const manager = makeManager();
    expectRoomError(
      () =>
        manager.reconnectRoom(
          {
            roomCode: "ABC234",
            playerId: "player-1",
            reconnectToken: `token-1-${"x".repeat(32)}`,
          },
          "socket-new",
        ),
      "ROOM_SESSION_EXPIRED",
    );
  });

  it("transfers host to the lowest connected seat", () => {
    const manager = makeManager();
    const setup = addTwoPlayers(manager);
    manager.disconnectSocket("socket-1");
    expect(manager.getRoom(setup.roomCode)?.hostPlayerId).toBe(
      setup.guest.credentials.playerId,
    );
  });

  it("enters FINISHED when only one survivor remains", () => {
    const manager = makeManager();
    const setup = startTwoPlayerGame(manager);
    const room = manager.getRoom(setup.roomCode)!;
    const guest = room.game!.getState().players.find(
      (player) => player.id === setup.guest.credentials.playerId,
    )!;
    guest.hp = 1;
    manager.submitAction(
      setup.roomCode,
      setup.host.credentials.playerId,
      "socket-1",
      1,
      { type: "ATTACK", targetPlayerId: setup.guest.credentials.playerId },
    );
    manager.submitAction(
      setup.roomCode,
      setup.guest.credentials.playerId,
      "socket-2",
      1,
      { type: "DEFEND" },
    );
    expect(room.phase).toBe("FINISHED");
    expect(room.game!.getState().result).toEqual({
      type: "WINNER",
      winnerPlayerId: setup.host.credentials.playerId,
    });
  });

  it("resets HP, game state, and readiness for a rematch", () => {
    const manager = makeManager();
    const setup = startTwoPlayerGame(manager);
    const room = manager.getRoom(setup.roomCode)!;
    const guest = room.game!.getState().players.find(
      (player) => player.id === setup.guest.credentials.playerId,
    )!;
    guest.hp = 1;
    manager.submitAction(setup.roomCode, setup.host.credentials.playerId, "socket-1", 1, { type: "ATTACK", targetPlayerId: setup.guest.credentials.playerId });
    manager.submitAction(setup.roomCode, setup.guest.credentials.playerId, "socket-2", 1, { type: "DEFEND" });
    manager.requestRematch(setup.roomCode, setup.host.credentials.playerId, "socket-1");
    expect(room.phase).toBe("LOBBY");
    expect(room.game).toBeNull();
    expect(room.players.every((player) => !player.ready)).toBe(true);
    expect(manager.getPlayerView(setup.roomCode, setup.host.credentials.playerId).players.every((player) => player.hp === MAX_HP)).toBe(true);
  });

  it("removes an abandoned lobby after its production cleanup TTL", () => {
    const manager = makeManager({ abandonedRoomTtlMs: 100 });
    const host = manager.createRoom("Host", "socket-1");
    manager.disconnectSocket("socket-1");
    vi.advanceTimersByTime(101);
    expect(manager.getRoom(host.credentials.roomCode)).toBeUndefined();
    expect(manager.getRoomCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears game and disconnect timers when an abandoned room is deleted", () => {
    const manager = makeManager({ abandonedRoomTtlMs: 100 });
    const setup = startTwoPlayerGame(manager);
    manager.disconnectSocket("socket-1");
    manager.disconnectSocket("socket-2");
    expect(manager.getRoom(setup.roomCode)?.timers.cleanup).not.toBeNull();
    expect(vi.getTimerCount()).toBeGreaterThan(1);

    vi.advanceTimersByTime(101);

    expect(manager.getRoom(setup.roomCode)).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("error-finishes a room when turn resolution throws and permits a rematch", () => {
    const manager = makeManager();
    const events: RoomManagerEvent[] = [];
    manager.onEvent((event) => events.push(event));
    const setup = startTwoPlayerGame(manager);
    const room = manager.getRoom(setup.roomCode)!;
    vi.spyOn(room.game!, "resolveCurrentTurn").mockImplementation(() => {
      throw new Error("engine failure");
    });

    manager.submitAction(
      setup.roomCode,
      setup.host.credentials.playerId,
      "socket-1",
      1,
      { type: "ATTACK", targetPlayerId: setup.guest.credentials.playerId },
    );
    manager.submitAction(
      setup.roomCode,
      setup.guest.credentials.playerId,
      "socket-2",
      1,
      { type: "DEFEND" },
    );

    expect(room.phase).toBe("FINISHED");
    expect(room.fatalError?.code).toBe("GAME_ENGINE_FAILURE");
    expect(events.some((event) => event.type === "GAME_ERROR")).toBe(true);
    manager.requestRematch(
      setup.roomCode,
      setup.host.credentials.playerId,
      "socket-1",
    );
    expect(room.phase).toBe("LOBBY");
    expect(room.fatalError).toBeNull();
  });

  it("keeps the original engine damage constants unchanged", () => {
    expect(NORMAL_DAMAGE).toBe(10);
    expect(MAX_HP).toBe(60);
  });
});
