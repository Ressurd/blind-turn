import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SeededRandomSource,
  type CharacterClassId,
  type PrivateCardView,
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
    generateRoomCode: () => codes[codeIndex++] ?? "ZZZ999",
    createPlayerId: () => `player-${++playerIndex}`,
    createReconnectToken: () => `token-${playerIndex}-${"x".repeat(32)}`,
    randomSourceFactory: () => new SeededRandomSource(700),
    actionTimeoutMs: 60_000,
    eventsFinishTimeoutMs: 8_000,
    rewardTimeoutMs: 30_000,
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

function selectAndReady(
  manager: RoomManager,
  setup = addTwoPlayers(manager),
  classes: [CharacterClassId, CharacterClassId] = ["DUELIST", "BERSERKER"],
) {
  manager.selectCharacter(setup.roomCode, setup.host.credentials.playerId, "socket-1", classes[0]);
  manager.selectCharacter(setup.roomCode, setup.guest.credentials.playerId, "socket-2", classes[1]);
  manager.setReady(setup.roomCode, setup.host.credentials.playerId, "socket-1", true);
  manager.setReady(setup.roomCode, setup.guest.credentials.playerId, "socket-2", true);
  return setup;
}

function startTwoPlayerGame(
  manager: RoomManager,
  classes: [CharacterClassId, CharacterClassId] = ["DUELIST", "BERSERKER"],
) {
  const setup = selectAndReady(manager, addTwoPlayers(manager), classes);
  manager.startGame(setup.roomCode, setup.host.credentials.playerId, "socket-1");
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

function actionInput(card: PrivateCardView, targetPlayerId: string) {
  return {
    cardInstanceId: card.instanceId,
    ...(card.definition.targetType === "ENEMY" ? { targetPlayerId } : {}),
    additionalSelection: null,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-15T12:00:00Z"));
});

afterEach(() => {
  for (const manager of managers.splice(0)) manager.destroy();
  vi.useRealTimers();
});

describe("room and lobby", () => {
  it("creates six-character non-confusing room codes and retries duplicates", () => {
    let cursor = 0;
    const code = createRoomCode(() => (cursor++ % ROOM_CODE_ALPHABET.length) / ROOM_CODE_ALPHABET.length);
    expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
    const codes = ["ABC234", "ABC234", "DEF567"];
    const manager = makeManager({ generateRoomCode: () => codes.shift()! });
    expect(manager.createRoom("A", "a").credentials.roomCode).toBe("ABC234");
    expect(manager.createRoom("B", "b").credentials.roomCode).toBe("DEF567");
  });

  it("allows 2–6 players and rejects duplicate nicknames", () => {
    const manager = makeManager();
    const host = manager.createRoom("P1", "s1");
    for (let index = 2; index <= 6; index += 1) {
      manager.joinRoom(host.credentials.roomCode, `P${index}`, `s${index}`);
    }
    expect(manager.getRoom(host.credentials.roomCode)?.players).toHaveLength(6);
    expectRoomError(() => manager.joinRoom(host.credentials.roomCode, "P7", "s7"), "ROOM_FULL");
    const other = makeManager().createRoom("Same", "x");
    expectRoomError(() => managers.at(-1)!.joinRoom(other.credentials.roomCode, "same", "y"), "NICKNAME_ALREADY_USED");
  });

  it("requires character selection before ready and resets ready when character changes", () => {
    const manager = makeManager();
    const host = manager.createRoom("Host", "socket-1");
    expectRoomError(() => manager.setReady(host.credentials.roomCode, host.credentials.playerId, "socket-1", true), "CHARACTER_NOT_SELECTED");
    manager.selectCharacter(host.credentials.roomCode, host.credentials.playerId, "socket-1", "GUARDIAN");
    manager.setReady(host.credentials.roomCode, host.credentials.playerId, "socket-1", true);
    manager.selectCharacter(host.credentials.roomCode, host.credentials.playerId, "socket-1", "DUELIST");
    expect(manager.getPlayerView(host.credentials.roomCode, host.credentials.playerId).players[0]?.ready).toBe(false);
  });

  it("starts only when all connected players selected a character and are ready", () => {
    const manager = makeManager();
    const setup = selectAndReady(manager);
    manager.startGame(setup.roomCode, setup.host.credentials.playerId, "socket-1");
    const view = manager.getPlayerView(setup.roomCode, setup.host.credentials.playerId);
    expect(view.phase).toBe("SELECTING_CARDS");
    expect(view.roundNumber).toBe(1);
    expect(view.actionDeadlineAt).toBe(Date.now() + 60_000);
  });
});

describe("private turn action", () => {
  it("shows the selected action only to its owner and exposes only confirmation publicly", () => {
    const manager = makeManager();
    const setup = startTwoPlayerGame(manager);
    const hostView = manager.getPlayerView(setup.roomCode, setup.host.credentials.playerId);
    const card = hostView.myHand[0]!;
    manager.selectAction(
      setup.roomCode,
      setup.host.credentials.playerId,
      "socket-1",
      1,
      actionInput(card, setup.guest.credentials.playerId),
    );
    const owner = manager.getPlayerView(setup.roomCode, setup.host.credentials.playerId);
    const opponent = manager.getPlayerView(setup.roomCode, setup.guest.credentials.playerId);
    expect(owner.mySelectedAction).toEqual(expect.objectContaining({
      cardInstanceId: card.instanceId,
    }));
    expect(opponent.mySelectedAction).toBeNull();
    expect(opponent.players.find((player) => player.playerId === setup.host.credentials.playerId)?.usedCardCount).toBeNull();
    expect(JSON.stringify(opponent)).not.toContain(card.instanceId);
  });

  it("provides private pile aggregates without draw order and only public counts to opponents", () => {
    const manager = makeManager();
    const setup = startTwoPlayerGame(manager);
    const room = manager.getRoom(setup.roomCode)!;
    const hostState = room.game!.getState().players.find(
      (player) => player.id === setup.host.credentials.playerId,
    )!;
    hostState.deckState.drawPile[0] = {
      instanceId: "host-secret-draw",
      cardId: "BERSERKER_CRUSH",
    };
    const permanentlyRemoved = hostState.deckState.drawPile.pop()!;
    permanentlyRemoved.instanceId = "host-secret-removed";
    permanentlyRemoved.cardId = "COMMON_GAMBLE";
    hostState.deckState.permanentlyRemovedCards.push(permanentlyRemoved);
    const owner = manager.getPlayerView(setup.roomCode, setup.host.credentials.playerId);
    const opponent = manager.getPlayerView(setup.roomCode, setup.guest.credentials.playerId);
    expect(owner.myDrawPileSummary.find((summary) => summary.cardId === "BERSERKER_CRUSH")?.drawPileCount).toBe(1);
    expect(owner.myDrawPileSummary.every((summary) => !("instanceId" in summary))).toBe(true);
    expect(owner.myDeckSummary.reduce((sum, summary) => sum + summary.totalCount, 0)).toBe(owner.totalDeckCount);
    expect(owner.myPermanentlyRemovedCards).toContainEqual(expect.objectContaining({
      instanceId: "host-secret-removed",
      cardId: "COMMON_GAMBLE",
    }));
    expect(owner.permanentlyRemovedCount).toBe(1);
    expect(JSON.stringify(opponent)).not.toContain("BERSERKER_CRUSH");
    expect(JSON.stringify(opponent)).not.toContain("COMMON_GAMBLE");
    expect(JSON.stringify(opponent)).not.toContain("host-secret-removed");
    const publicHost = opponent.players.find((player) => player.playerId === setup.host.credentials.playerId)!;
    expect(publicHost).toMatchObject({
      handCount: hostState.deckState.hand.length,
      drawPileCount: hostState.deckState.drawPile.length,
      discardPileCount: hostState.deckState.discardPile.length,
      totalDeckCount: 9,
      permanentlyRemovedCount: 1,
    });
  });

  it("emits action changes, turn lock, hidden count reveal, and one identical result payload", () => {
    const manager = makeManager();
    const events: RoomManagerEvent[] = [];
    manager.onEvent((event) => events.push(event));
    const setup = startTwoPlayerGame(manager);
    const hostCard = manager.getPlayerView(setup.roomCode, setup.host.credentials.playerId).myHand[0]!;
    manager.selectAction(setup.roomCode, setup.host.credentials.playerId, "socket-1", 1, actionInput(hostCard, setup.guest.credentials.playerId));
    manager.confirmAction(setup.roomCode, setup.host.credentials.playerId, "socket-1", 1);
    manager.confirmAction(setup.roomCode, setup.guest.credentials.playerId, "socket-2", 1);

    expect(events.some((event) => event.type === "ACTION_UPDATED")).toBe(true);
    expect(events.some((event) => event.type === "ROUND_LOCKED")).toBe(true);
    expect(events.find((event) => event.type === "CARD_COUNTS_REVEALED")).toMatchObject({
      cardCounts: expect.arrayContaining([
        { playerId: setup.host.credentials.playerId, count: 1 },
        { playerId: setup.guest.credentials.playerId, count: 0 },
      ]),
    });
    const resolvedEvents = events.filter((event) => event.type === "ROUND_RESOLVED");
    expect(resolvedEvents).toHaveLength(1);
    expect(manager.getRoom(setup.roomCode)?.phase).toBe("RESOLVING_ROUND");
  });

  it("auto-confirms missing players as PASS after 60 seconds", () => {
    const manager = makeManager();
    const setup = startTwoPlayerGame(manager);
    vi.advanceTimersByTime(60_000);
    expect(manager.getRoom(setup.roomCode)?.phase).toBe("RESOLVING_ROUND");
    expect(manager.getRoom(setup.roomCode)?.lockedCardCounts.get(setup.host.credentials.playerId)).toBe(0);
  });

  it("waits for playback acknowledgements and then starts the next round", () => {
    const manager = makeManager();
    const setup = startTwoPlayerGame(manager);
    manager.confirmAction(setup.roomCode, setup.host.credentials.playerId, "socket-1", 1);
    manager.confirmAction(setup.roomCode, setup.guest.credentials.playerId, "socket-2", 1);
    manager.eventsFinished(setup.roomCode, setup.host.credentials.playerId, "socket-1", 1);
    expect(manager.getRoom(setup.roomCode)?.phase).toBe("RESOLVING_ROUND");
    manager.eventsFinished(setup.roomCode, setup.guest.credentials.playerId, "socket-2", 1);
    expect(manager.getRoom(setup.roomCode)?.phase).toBe("SELECTING_CARDS");
    expect(manager.getRoom(setup.roomCode)?.game?.getState().roundNumber).toBe(2);
  });

  it("opens private two-card reward selection and honors the configured timeout", () => {
    const manager = makeManager();
    const setup = startTwoPlayerGame(manager, ["TACTICIAN", "BERSERKER"]);
    const room = manager.getRoom(setup.roomCode)!;
    room.game!.getState().roundNumber = 3;
    manager.confirmAction(setup.roomCode, setup.host.credentials.playerId, "socket-1", 3);
    manager.confirmAction(setup.roomCode, setup.guest.credentials.playerId, "socket-2", 3);
    manager.eventsFinished(setup.roomCode, setup.host.credentials.playerId, "socket-1", 3);
    manager.eventsFinished(setup.roomCode, setup.guest.credentials.playerId, "socket-2", 3);
    expect(room.phase).toBe("SELECTING_REWARD");
    const rewardView = manager.getPlayerView(setup.roomCode, setup.host.credentials.playerId);
    expect(rewardView.rewardOptions).toHaveLength(4);
    expect(new Set(rewardView.rewardOptions.map((card) => card.id)).size).toBe(4);
    const selectedIds = [
      rewardView.rewardOptions[0]!.id,
      rewardView.rewardOptions[2]!.id,
    ];
    manager.updateRewardSelection(
      setup.roomCode,
      setup.host.credentials.playerId,
      "socket-1",
      selectedIds,
    );
    const draftView = manager.getPlayerView(setup.roomCode, setup.host.credentials.playerId);
    const hiddenFromGuest = manager.getPlayerView(setup.roomCode, setup.guest.credentials.playerId);
    expect(draftView.selectedRewards.map((card) => card.id)).toEqual(selectedIds);
    expect(draftView.rewardSelectionConfirmed).toBe(false);
    expect(JSON.stringify(hiddenFromGuest)).not.toContain(selectedIds[0]);
    expect(JSON.stringify(hiddenFromGuest)).not.toContain(selectedIds[1]);
    manager.disconnectSocket("socket-1");
    const restoredReward = manager.reconnectRoom(setup.host.credentials, "socket-reward");
    expect(restoredReward.view.rewardOptions.map((card) => card.id)).toEqual(
      rewardView.rewardOptions.map((card) => card.id),
    );
    expect(restoredReward.view.selectedRewards.map((card) => card.id)).toEqual(selectedIds);
    manager.confirmReward(setup.roomCode, setup.host.credentials.playerId, "socket-reward");
    const selectedView = manager.getPlayerView(setup.roomCode, setup.host.credentials.playerId);
    expect(selectedView.selectedRewards.map((card) => card.id)).toEqual(selectedIds);
    expect(selectedView.rewardSelectionConfirmed).toBe(true);
    expect(selectedView.rewardOptions).toHaveLength(0);
    expect(selectedView.rewardSelectionStatus).toEqual({ selectedPlayerCount: 1, totalPlayerCount: 2 });
    vi.advanceTimersByTime(30_000);
    expect(room.phase).toBe("SELECTING_CARDS");
    expect(room.game!.getState().roundNumber).toBe(4);
  });

  it("restores multi-card deck trimming state and keeps current reward cards disabled", () => {
    const manager = makeManager();
    const setup = startTwoPlayerGame(manager);
    const room = manager.getRoom(setup.roomCode)!;
    const state = room.game!.getState();
    state.roundNumber = 3;
    for (const player of state.players) {
      player.deckState.drawPile.push(...Array.from({ length: 4 }, (_, index) => ({
        instanceId: `${player.id}:legacy-extra:${index}`,
        cardId: "BASE_GUARD",
      })));
    }
    manager.confirmAction(setup.roomCode, setup.host.credentials.playerId, "socket-1", 3);
    manager.confirmAction(setup.roomCode, setup.guest.credentials.playerId, "socket-2", 3);
    manager.eventsFinished(setup.roomCode, setup.host.credentials.playerId, "socket-1", 3);
    manager.eventsFinished(setup.roomCode, setup.guest.credentials.playerId, "socket-2", 3);

    for (const [credentials, socketId] of [
      [setup.host.credentials, "socket-1"],
      [setup.guest.credentials, "socket-2"],
    ] as const) {
      const reward = manager.getPlayerView(setup.roomCode, credentials.playerId);
      manager.updateRewardSelection(
        setup.roomCode,
        credentials.playerId,
        socketId,
        [reward.rewardOptions[0]!.id, reward.rewardOptions[2]!.id],
      );
      manager.confirmReward(setup.roomCode, credentials.playerId, socketId);
    }

    expect(room.phase).toBe("SELECTING_DECK_REMOVAL");
    const removal = manager.getPlayerView(setup.roomCode, setup.host.credentials.playerId);
    expect(removal.totalDeckCount).toBe(16);
    expect(removal.requiredRemovalCount).toBe(1);
    expect(removal.deckRemovalCards.filter((card) => card.newlyAdded)).toHaveLength(2);
    expect(removal.deckRemovalCards.filter((card) => card.newlyAdded).every((card) => !card.removable)).toBe(true);
    const selectedId = removal.deckRemovalCards.find((card) => card.removable)!.instanceId;
    manager.updateDeckRemoval(
      setup.roomCode,
      setup.host.credentials.playerId,
      "socket-1",
      [selectedId],
    );
    manager.disconnectSocket("socket-1");
    const restored = manager.reconnectRoom(setup.host.credentials, "socket-trim");
    expect(restored.view.selectedRemovalInstanceIds).toEqual([selectedId]);
    expect(restored.view.requiredRemovalCount).toBe(1);
    expect(restored.view.rewardDeadlineAt).not.toBeNull();
  });
});

describe("reconnect, chat, and cleanup", () => {
  it("restores the same private hand and selected action with a valid reconnect token", () => {
    const manager = makeManager();
    const setup = startTwoPlayerGame(manager);
    const before = manager.getPlayerView(setup.roomCode, setup.host.credentials.playerId);
    manager.disconnectSocket("socket-1");
    const restored = manager.reconnectRoom(setup.host.credentials, "socket-new");
    expect(restored.view.myHand).toEqual(before.myHand);
    expect(restored.view.roundNumber).toBe(before.roundNumber);
  });

  it("normalizes chat, uses server identity, keeps 50, and limits two per second", () => {
    const manager = makeManager();
    const setup = addTwoPlayers(manager);
    const first = manager.sendChat(setup.roomCode, setup.host.credentials.playerId, "socket-1", "  hello   world  ");
    expect(first).toMatchObject({ nickname: "Host", message: "hello world", kind: "PLAYER" });
    manager.sendChat(setup.roomCode, setup.host.credentials.playerId, "socket-1", "second");
    expectRoomError(() => manager.sendChat(setup.roomCode, setup.host.credentials.playerId, "socket-1", "third"), "CHAT_RATE_LIMITED");
  });

  it("blocks dead-player chat and exposes only draw counts in public playback", () => {
    const manager = makeManager();
    const setup = startTwoPlayerGame(manager);
    manager.getRoom(setup.roomCode)!.game!.getState().players[0]!.alive = false;
    expectRoomError(() => manager.sendChat(setup.roomCode, setup.host.credentials.playerId, "socket-1", "boo"), "CHAT_DEAD_PLAYER");
    expect(createPublicEvents([
      { type: "CARD_DRAWN", playerId: "p1", count: 1, drawPileCount: 4, handCount: 3 },
      { type: "ROUND_STARTED", roundNumber: 1 },
    ])).toEqual([
      { type: "CARD_DRAWN", playerId: "p1", count: 1, drawPileCount: 4, handCount: 3 },
      { type: "ROUND_STARTED", roundNumber: 1 },
    ]);
  });

  it("publishes one turn-resolution boundary without step metadata", () => {
    const events = createPublicEvents([
      { type: "TURN_RESOLUTION_STARTED", roundNumber: 1 },
      { type: "TURN_RESOLUTION_FINISHED", roundNumber: 1 },
    ]);
    expect(events).toEqual([
      { type: "TURN_RESOLUTION_STARTED", roundNumber: 1 },
      { type: "TURN_RESOLUTION_FINISHED", roundNumber: 1 },
    ]);
    expect(JSON.stringify(events)).not.toMatch(/stepIndex|cancelled/i);
  });

  it("transfers host and removes abandoned rooms after cleanup TTL", () => {
    const manager = makeManager({ abandonedRoomTtlMs: 1_000 });
    const setup = addTwoPlayers(manager);
    manager.disconnectSocket("socket-1");
    expect(manager.getRoom(setup.roomCode)?.hostPlayerId).toBe(setup.guest.credentials.playerId);
    manager.disconnectSocket("socket-2");
    vi.advanceTimersByTime(1_000);
    expect(manager.getRoom(setup.roomCode)).toBeUndefined();
  });
});
