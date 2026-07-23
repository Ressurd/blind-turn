import { afterEach, describe, expect, it } from "vitest";
import {
  PVE_CHARACTER_ORDER,
  type PveCharacterId,
  type PveRoomIdentityResult,
} from "@blind-turn/shared";
import { PveRoomManager } from "../src/pve/pve-room-manager";

const managers: PveRoomManager[] = [];

function makeManager(playbackTimeoutMs = 60_000) {
  let roomNumber = 0;
  let playerNumber = 0;
  const manager = new PveRoomManager({
    playbackTimeoutMs,
    generateRoomCode: () => `PVE00${++roomNumber}`.slice(-6),
    createPlayerId: () => `player-${++playerNumber}`,
    createReconnectToken: () => `token-${playerNumber}`.padEnd(24, "x"),
  });
  managers.push(manager);
  return manager;
}

type AssignmentSetup = {
  roomCode: string;
  identities: PveRoomIdentityResult[];
  assignments: PveCharacterId[][];
};

function setupAssignments(
  manager: PveRoomManager,
  assignments: PveCharacterId[][],
): AssignmentSetup {
  const host = manager.createRoom("Host", "socket-1");
  const identities = [host];
  for (let index = 1; index < assignments.length; index += 1) {
    identities.push(manager.joinRoom(host.credentials.roomCode, `P${index + 1}`, `socket-${index + 1}`));
  }
  assignments.forEach((characterIds, index) => {
    const identity = identities[index]!;
    for (const characterId of characterIds) {
      manager.toggleCharacter(
        host.credentials.roomCode,
        identity.credentials.playerId,
        `socket-${index + 1}`,
        characterId,
      );
    }
    manager.setReady(
      host.credentials.roomCode,
      identity.credentials.playerId,
      `socket-${index + 1}`,
      true,
    );
  });
  return { roomCode: host.credentials.roomCode, identities, assignments };
}

function startSetup(manager: PveRoomManager, setup: AssignmentSetup): void {
  manager.startGame(setup.roomCode, setup.identities[0]!.credentials.playerId, "socket-1");
}

function fillPassPlan(
  manager: PveRoomManager,
  roomCode: string,
  playerId: string,
  socketId: string,
  characterIds: readonly PveCharacterId[],
  turnNumber = 1,
): void {
  for (const characterId of characterIds) {
    for (const beat of [1, 2, 3] as const) {
      manager.setPlanSlot(
        roomCode,
        playerId,
        socketId,
        characterId,
        turnNumber,
        beat,
        { actionId: "PASS" },
      );
    }
  }
}

function fillAndConfirm(manager: PveRoomManager, setup: AssignmentSetup, turnNumber = 1): void {
  setup.identities.forEach((identity, index) => {
    fillPassPlan(
      manager,
      setup.roomCode,
      identity.credentials.playerId,
      `socket-${index + 1}`,
      setup.assignments[index]!,
      turnNumber,
    );
    manager.setConfirmed(
      setup.roomCode,
      identity.credentials.playerId,
      `socket-${index + 1}`,
      turnNumber,
      true,
    );
  });
}

afterEach(() => {
  for (const manager of managers.splice(0)) manager.destroy();
});

describe("PveRoomManager", () => {
  it("keeps the room maximum at four and rejects duplicate or third character assignments", () => {
    const manager = makeManager();
    const host = manager.createRoom("P1", "s1");
    const guest = manager.joinRoom(host.credentials.roomCode, "P2", "s2");
    manager.joinRoom(host.credentials.roomCode, "P3", "s3");
    manager.joinRoom(host.credentials.roomCode, "P4", "s4");
    expect(() => manager.joinRoom(host.credentials.roomCode, "P5", "s5"))
      .toThrowError(expect.objectContaining({ code: "ROOM_FULL" }));

    manager.toggleCharacter(host.credentials.roomCode, host.credentials.playerId, "s1", "WARRIOR");
    expect(() => manager.toggleCharacter(host.credentials.roomCode, guest.credentials.playerId, "s2", "WARRIOR"))
      .toThrowError(expect.objectContaining({ code: "PVE_ROLE_TAKEN" }));
    manager.toggleCharacter(host.credentials.roomCode, host.credentials.playerId, "s1", "PRIEST");
    expect(() => manager.toggleCharacter(host.credentials.roomCode, host.credentials.playerId, "s1", "MAGE"))
      .toThrowError(expect.objectContaining({ code: "PVE_CHARACTER_LIMIT" }));
  });

  it("does not start with only one player", () => {
    const manager = makeManager();
    const host = manager.createRoom("Solo", "s1");
    manager.toggleCharacter(host.credentials.roomCode, host.credentials.playerId, "s1", "WARRIOR");
    manager.toggleCharacter(host.credentials.roomCode, host.credentials.playerId, "s1", "PRIEST");
    manager.setReady(host.credentials.roomCode, host.credentials.playerId, "s1", true);
    expect(() => manager.startGame(host.credentials.roomCode, host.credentials.playerId, "s1"))
      .toThrowError(expect.objectContaining({ code: "NOT_ENOUGH_PLAYERS" }));
  });

  it.each([
    ["two players with 2+2", [["WARRIOR", "PRIEST"], ["ARCHER", "MAGE"]]],
    ["three players with 2+1+1", [["WARRIOR", "PRIEST"], ["ARCHER"], ["MAGE"]]],
    ["four players with 1+1+1+1", [["WARRIOR"], ["ARCHER"], ["MAGE"], ["PRIEST"]]],
  ] as const)("starts with %s assignments", (_label, assignments) => {
    const manager = makeManager();
    const setup = setupAssignments(
      manager,
      assignments.map((ids) => [...ids]) as PveCharacterId[][],
    );
    startSetup(manager, setup);
    expect(manager.getRoom(setup.roomCode)?.phase).toBe("PLANNING");
  });

  it("reports an unassigned character and requires every participant to own one", () => {
    const manager = makeManager();
    const host = manager.createRoom("Host", "s1");
    const guest = manager.joinRoom(host.credentials.roomCode, "Guest", "s2");
    const observer = manager.joinRoom(host.credentials.roomCode, "Observer", "s3");
    manager.toggleCharacter(host.credentials.roomCode, host.credentials.playerId, "s1", "WARRIOR");
    manager.toggleCharacter(host.credentials.roomCode, host.credentials.playerId, "s1", "PRIEST");
    manager.toggleCharacter(host.credentials.roomCode, guest.credentials.playerId, "s2", "ARCHER");
    manager.setReady(host.credentials.roomCode, host.credentials.playerId, "s1", true);
    manager.setReady(host.credentials.roomCode, guest.credentials.playerId, "s2", true);
    expect(() => manager.setReady(host.credentials.roomCode, observer.credentials.playerId, "s3", true))
      .toThrowError(expect.objectContaining({ code: "CHARACTER_NOT_SELECTED" }));
    expect(() => manager.startGame(host.credentials.roomCode, host.credentials.playerId, "s1"))
      .toThrowError(expect.objectContaining({ code: "CHARACTER_NOT_SELECTED" }));
  });

  it("allows both owned plans, rejects foreign plans, and confirms all owned plans together", () => {
    const manager = makeManager();
    const setup = setupAssignments(manager, [
      ["WARRIOR", "PRIEST"],
      ["ARCHER", "MAGE"],
    ]);
    startSetup(manager, setup);
    const host = setup.identities[0]!;
    fillPassPlan(manager, setup.roomCode, host.credentials.playerId, "socket-1", ["WARRIOR", "PRIEST"]);
    expect(manager.getRoom(setup.roomCode)?.plans.WARRIOR.every(Boolean)).toBe(true);
    expect(manager.getRoom(setup.roomCode)?.plans.PRIEST.every(Boolean)).toBe(true);
    expect(() => manager.setPlanSlot(
      setup.roomCode,
      host.credentials.playerId,
      "socket-1",
      "ARCHER",
      1,
      1,
      { actionId: "PASS" },
    )).toThrowError(expect.objectContaining({ code: "SOCKET_NOT_OWNER" }));
    manager.setConfirmed(setup.roomCode, host.credentials.playerId, "socket-1", 1, true);
    expect(manager.getRoom(setup.roomCode)?.confirmedPlayerIds.size).toBe(1);
    expect(() => manager.setPlanSlot(
      setup.roomCode,
      host.credentials.playerId,
      "socket-1",
      "WARRIOR",
      1,
      1,
      { actionId: "WARRIOR_DEFEND" },
    )).toThrowError(expect.objectContaining({ code: "PVE_PLAN_LOCKED" }));
  });

  it("rejects confirmation until all six actions of a two-character owner are filled", () => {
    const manager = makeManager();
    const setup = setupAssignments(manager, [
      ["WARRIOR", "PRIEST"],
      ["ARCHER", "MAGE"],
    ]);
    startSetup(manager, setup);
    const host = setup.identities[0]!;
    fillPassPlan(manager, setup.roomCode, host.credentials.playerId, "socket-1", ["WARRIOR"]);
    expect(() => manager.setConfirmed(setup.roomCode, host.credentials.playerId, "socket-1", 1, true))
      .toThrowError(expect.objectContaining({ code: "PVE_PLAN_INVALID" }));
  });

  it("uses the actual two-player confirmation count and resolves exactly once", () => {
    const manager = makeManager();
    const setup = setupAssignments(manager, [
      ["WARRIOR", "PRIEST"],
      ["ARCHER", "MAGE"],
    ]);
    startSetup(manager, setup);
    const resolved: number[] = [];
    manager.onEvent((event) => {
      if (event.type === "TURN_RESOLVED") resolved.push(event.payload.turnNumber);
    });
    setup.identities.forEach((identity, index) => {
      fillPassPlan(
        manager,
        setup.roomCode,
        identity.credentials.playerId,
        `socket-${index + 1}`,
        setup.assignments[index]!,
      );
    });
    manager.setConfirmed(setup.roomCode, setup.identities[0]!.credentials.playerId, "socket-1", 1, true);
    expect(manager.getPlayerView(setup.roomCode, setup.identities[0]!.credentials.playerId).confirmedPlayerIds)
      .toHaveLength(1);
    expect(manager.getRoom(setup.roomCode)?.phase).toBe("PLANNING");
    manager.setConfirmed(setup.roomCode, setup.identities[1]!.credentials.playerId, "socket-2", 1, true);
    expect(manager.getRoom(setup.roomCode)?.phase).toBe("RESOLVING");
    expect(resolved).toEqual([1]);
    expect(() => manager.setConfirmed(setup.roomCode, setup.identities[1]!.credentials.playerId, "socket-2", 1, true))
      .toThrowError(expect.objectContaining({ code: "INVALID_GAME_PHASE" }));
  });

  it("restores every assigned character, their plans, and confirmation on reconnect", () => {
    const manager = makeManager();
    const setup = setupAssignments(manager, [
      ["WARRIOR", "PRIEST"],
      ["ARCHER", "MAGE"],
    ]);
    startSetup(manager, setup);
    const host = setup.identities[0]!;
    fillPassPlan(manager, setup.roomCode, host.credentials.playerId, "socket-1", ["WARRIOR", "PRIEST"]);
    manager.setConfirmed(setup.roomCode, host.credentials.playerId, "socket-1", 1, true);
    manager.disconnectSocket("socket-1");
    const reconnected = manager.reconnectRoom(host.credentials, "socket-1b");
    expect(reconnected.view.myAssignedCharacterIds).toEqual(["WARRIOR", "PRIEST"]);
    expect(reconnected.view.plans.WARRIOR.every((action) => action?.actionId === "PASS")).toBe(true);
    expect(reconnected.view.plans.PRIEST.every((action) => action?.actionId === "PASS")).toBe(true);
    expect(reconnected.view.players.find((player) => player.playerId === host.credentials.playerId)?.confirmed)
      .toBe(true);
  });

  it("keeps all assignments across a unanimous rematch", () => {
    const manager = makeManager();
    const setup = setupAssignments(manager, [
      ["WARRIOR", "PRIEST"],
      ["ARCHER", "MAGE"],
    ]);
    startSetup(manager, setup);
    const room = manager.getRoom(setup.roomCode)!;
    room.phase = "RESULT";
    room.battleState.result = "VICTORY";
    setup.identities.forEach((identity, index) => {
      manager.requestRematch(
        setup.roomCode,
        identity.credentials.playerId,
        `socket-${index + 1}`,
      );
    });
    expect(room.phase).toBe("PLANNING");
    expect(room.players.map((player) => player.assignedCharacterIds)).toEqual([
      ["WARRIOR", "PRIEST"],
      ["ARCHER", "MAGE"],
    ]);
  });

  it("keeps HP and positions, clears all four plans, and cycles boss patterns", () => {
    const manager = makeManager();
    const setup = setupAssignments(manager, [
      ["WARRIOR", "PRIEST"],
      ["ARCHER", "MAGE"],
    ]);
    startSetup(manager, setup);
    const initialPosition = manager.getRoom(setup.roomCode)!.battleState.characters.WARRIOR.position;
    fillAndConfirm(manager, setup);
    const hpAfterTurn = manager.getRoom(setup.roomCode)!.battleState.characters.WARRIOR.hp;
    setup.identities.forEach((identity, index) => {
      manager.playbackFinished(
        setup.roomCode,
        identity.credentials.playerId,
        `socket-${index + 1}`,
        1,
      );
    });
    const room = manager.getRoom(setup.roomCode)!;
    expect(room.phase).toBe("PLANNING");
    expect(room.turnNumber).toBe(2);
    expect(room.battleState.characters.WARRIOR.hp).toBe(hpAfterTurn);
    expect(room.battleState.characters.WARRIOR.position).toEqual(initialPosition);
    for (const characterId of PVE_CHARACTER_ORDER) {
      expect(room.plans[characterId]).toEqual([null, null, null]);
    }
    expect(room.bossPlan.map((intent) => intent.id)).toEqual([
      "UPPER_COLLAPSE", "MELEE_SMASH", "FRACTURE_EXPLOSION",
    ]);
  });
});
