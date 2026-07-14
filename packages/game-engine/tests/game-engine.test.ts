import { describe, expect, it } from "vitest";
import {
  CRITICAL_DAMAGE,
  MAX_HP,
  NORMAL_DAMAGE,
  REDUCED_DAMAGE,
  SeededRandomSource,
  SequenceRandomSource,
  createGame,
  resolveTurn,
  startTurn,
  submitAction,
  type GameState,
  type PlayerAction,
} from "../src";

function makeGame(count = 3): GameState {
  const names = ["A", "B", "C", "D", "E", "F"];
  return createGame(
    Array.from({ length: count }, (_, index) => ({
      id: `p${index + 1}`,
      nickname: names[index]!,
      seatNumber: index + 1,
    })),
  );
}

function beginTurn(
  state: GameState,
  speeds: number[],
  hiddenTieRolls: number[] = [],
): GameState {
  return startTurn(
    state,
    new SequenceRandomSource(
      { SPEED: speeds, HIDDEN_TIE: hiddenTieRolls },
      new SeededRandomSource(41),
    ),
  );
}

function submitAll(
  state: GameState,
  actions: Record<string, PlayerAction>,
): GameState {
  let nextState = state;
  for (const player of state.players.filter((candidate) => candidate.alive)) {
    const action = actions[player.id];
    if (!action) throw new Error(`Missing action for ${player.id}`);
    nextState = submitAction(nextState, player.id, action);
  }
  return nextState;
}

function playTurn(
  state: GameState,
  speeds: number[],
  actions: Record<string, PlayerAction>,
  combat: { clash?: number[]; evade?: number[] } = {},
) {
  const started = beginTurn(state, speeds);
  const submitted = submitAll(started, actions);
  return resolveTurn(
    submitted,
    new SequenceRandomSource(
      { CLASH: combat.clash ?? [], EVADE: combat.evade ?? [] },
      new SeededRandomSource(83),
    ),
  );
}

function player(state: GameState, id: string) {
  return state.players.find((candidate) => candidate.id === id)!;
}

describe("game creation and initiative", () => {
  it("stores the visible 30 HP as the scaled internal value 60", () => {
    const state = makeGame(2);
    expect(state.players.map((candidate) => candidate.hp)).toEqual([60, 60]);
    expect(MAX_HP).toBe(60);
  });

  it("accepts only 2 to 6 players with unique ids and seats", () => {
    expect(() => makeGame(1)).toThrow(/2 to 6/);
    expect(() => makeGame(6)).not.toThrow();
    expect(() =>
      createGame([
        { id: "same", nickname: "A", seatNumber: 1 },
        { id: "same", nickname: "B", seatNumber: 2 },
      ]),
    ).toThrow(/Duplicate player id/);
  });

  it("rolls speed for alive players only", () => {
    const initial = makeGame(3);
    const withDeadPlayer: GameState = {
      ...initial,
      players: initial.players.map((candidate) =>
        candidate.id === "p2"
          ? { ...candidate, hp: 0, alive: false }
          : candidate,
      ),
    };
    const state = beginTurn(withDeadPlayer, [9, 4]);
    expect(player(state, "p1").speedRoll).toBe(9);
    expect(player(state, "p2").speedRoll).toBeNull();
    expect(player(state, "p3").speedRoll).toBe(4);
    expect(state.actionOrder).toEqual(["p1", "p3"]);
  });

  it("sorts higher speed first", () => {
    const state = beginTurn(makeGame(4), [9, 7, 8, 1]);
    expect(state.actionOrder).toEqual(["p1", "p3", "p2", "p4"]);
  });

  it("assigns non-duplicating hidden rolls inside a tied speed group", () => {
    const state = beginTurn(makeGame(3), [7, 7, 7], [8, 2, 8]);
    expect(player(state, "p1").hiddenTieRoll).toBe(8);
    expect(player(state, "p2").hiddenTieRoll).toBe(2);
    expect(player(state, "p3").hiddenTieRoll).toBe(10);
    expect(new Set(state.players.map((candidate) => candidate.hiddenTieRoll)).size).toBe(3);
    expect(state.actionOrder).toEqual(["p3", "p1", "p2"]);
  });

  it("assigns tie rolls by turn-start HP, nickname, then seat", () => {
    const initial = makeGame(3);
    const wounded: GameState = {
      ...initial,
      players: initial.players.map((candidate) => {
        if (candidate.id === "p1") return { ...candidate, hp: 50, nickname: "Z" };
        if (candidate.id === "p2") return { ...candidate, hp: 40, nickname: "Y" };
        return { ...candidate, hp: 40, nickname: "A" };
      }),
    };
    const state = beginTurn(wounded, [6, 6, 6], [1, 1, 1]);
    expect(player(state, "p3").hiddenTieRoll).toBe(1);
    expect(player(state, "p2").hiddenTieRoll).toBe(2);
    expect(player(state, "p1").hiddenTieRoll).toBe(3);
    expect(state.turnStartHp).toEqual({ p1: 50, p2: 40, p3: 40 });
  });

  it("does not mutate the state passed to startTurn or submitAction", () => {
    const initial = makeGame(2);
    const started = beginTurn(initial, [8, 2]);
    const submitted = submitAction(started, "p1", {
      type: "ATTACK",
      targetPlayerId: "p2",
    });
    expect(initial.turnNumber).toBe(0);
    expect(initial.players[0]!.speedRoll).toBeNull();
    expect(started.players[0]!.selectedAction).toBeNull();
    expect(submitted.players[0]!.selectedAction).toEqual({
      type: "ATTACK",
      targetPlayerId: "p2",
    });
  });
});

describe("action validation", () => {
  it("allows PASS to consume a timeout action without changing combat state", () => {
    const started = beginTurn(makeGame(2), [8, 4]);
    const submitted = submitAll(started, {
      p1: { type: "PASS" },
      p2: { type: "PASS" },
    });
    const result = resolveTurn(submitted, new SeededRandomSource(1));
    expect(result.state.players.map((candidate) => candidate.hp)).toEqual([
      MAX_HP,
      MAX_HP,
    ]);
    expect(result.events).toContainEqual({
      type: "ACTION_STARTED",
      playerId: "p1",
      actionType: "PASS",
    });
  });

  it("rejects self-targeting and targeting a dead player", () => {
    const initial = makeGame(3);
    const withDeadPlayer: GameState = {
      ...initial,
      players: initial.players.map((candidate) =>
        candidate.id === "p3"
          ? { ...candidate, hp: 0, alive: false }
          : candidate,
      ),
    };
    const state = beginTurn(withDeadPlayer, [8, 4]);
    expect(() =>
      submitAction(state, "p1", { type: "ATTACK", targetPlayerId: "p1" }),
    ).toThrow(/cannot target themselves/);
    expect(() =>
      submitAction(state, "p1", { type: "COUNTER", targetPlayerId: "p3" }),
    ).toThrow(/dead player/);
  });

  it("rejects a second submission from the same player", () => {
    const state = beginTurn(makeGame(2), [8, 4]);
    const submitted = submitAction(state, "p1", { type: "DEFEND" });
    expect(() => submitAction(submitted, "p1", { type: "EVADE" })).toThrow(
      /already submitted/,
    );
  });
});

describe("defense and exposed attacks", () => {
  it("does not reduce damage before the defender's action activates", () => {
    const result = playTurn(makeGame(2), [9, 1], {
      p1: { type: "ATTACK", targetPlayerId: "p2" },
      p2: { type: "DEFEND" },
    });
    expect(player(result.state, "p2").hp).toBe(MAX_HP - NORMAL_DAMAGE);
  });

  it("reduces damage to 2.5 after defense activates", () => {
    const result = playTurn(makeGame(2), [1, 9], {
      p1: { type: "ATTACK", targetPlayerId: "p2" },
      p2: { type: "DEFEND" },
    });
    expect(player(result.state, "p2").hp).toBe(MAX_HP - REDUCED_DAMAGE);
    expect(player(result.state, "p2").activeDefense).toBe(false);
  });

  it("applies 10 exposed damage after a target completed an attack facing elsewhere", () => {
    const result = playTurn(makeGame(3), [9, 1, 8], {
      p1: { type: "ATTACK", targetPlayerId: "p2" },
      p2: { type: "DEFEND" },
      p3: { type: "ATTACK", targetPlayerId: "p1" },
    });
    expect(player(result.state, "p1").hp).toBe(MAX_HP - CRITICAL_DAMAGE);
    expect(result.events).toContainEqual({
      type: "EXPOSED_ATTACK",
      attackerId: "p3",
      targetId: "p1",
    });
  });

  it("does not treat a player who has not acted as exposed", () => {
    const result = playTurn(makeGame(3), [9, 2, 1], {
      p1: { type: "ATTACK", targetPlayerId: "p3" },
      p2: { type: "DEFEND" },
      p3: { type: "ATTACK", targetPlayerId: "p2" },
    });
    expect(player(result.state, "p3").hp).toBe(MAX_HP - NORMAL_DAMAGE);
    expect(result.events.some((event) => event.type === "EXPOSED_ATTACK")).toBe(false);
  });
});

describe("clash", () => {
  it("resolves mutual attacks once and consumes the slower action", () => {
    const result = playTurn(
      makeGame(2),
      [9, 4],
      {
        p1: { type: "ATTACK", targetPlayerId: "p2" },
        p2: { type: "ATTACK", targetPlayerId: "p1" },
      },
      { clash: [8, 5] },
    );
    expect(player(result.state, "p1").hp).toBe(MAX_HP);
    expect(player(result.state, "p2").hp).toBe(MAX_HP - NORMAL_DAMAGE);
    expect(player(result.state, "p1").facingTargetId).toBe("p2");
    expect(player(result.state, "p2").facingTargetId).toBe("p1");
    expect(result.events).toContainEqual({
      type: "ACTION_SKIPPED",
      playerId: "p2",
      reason: "ACTION_ALREADY_CONSUMED",
    });
  });

  it("rerolls both clash dice until the tie is broken", () => {
    const result = playTurn(
      makeGame(2),
      [9, 4],
      {
        p1: { type: "ATTACK", targetPlayerId: "p2" },
        p2: { type: "ATTACK", targetPlayerId: "p1" },
      },
      { clash: [4, 4, 3, 7] },
    );
    expect(player(result.state, "p1").hp).toBe(MAX_HP - NORMAL_DAMAGE);
    expect(
      result.events.filter((event) => event.type === "CLASH_ROLLED"),
    ).toHaveLength(4);
  });
});

describe("evade", () => {
  it("keeps evade active and deals no damage after a successful roll", () => {
    const result = playTurn(
      makeGame(2),
      [4, 9],
      {
        p1: { type: "ATTACK", targetPlayerId: "p2" },
        p2: { type: "EVADE" },
      },
      { evade: [8] },
    );
    expect(player(result.state, "p2").hp).toBe(MAX_HP);
    expect(result.events).toContainEqual({ type: "EVADE_SUCCEEDED", playerId: "p2" });
  });

  it("deals a final 10 damage and ends evade after a failed roll", () => {
    const result = playTurn(
      makeGame(2),
      [8, 9],
      {
        p1: { type: "ATTACK", targetPlayerId: "p2" },
        p2: { type: "EVADE" },
      },
      { evade: [3] },
    );
    expect(player(result.state, "p2").hp).toBe(MAX_HP - CRITICAL_DAMAGE);
    expect(result.events).toContainEqual({ type: "EVADE_FAILED", playerId: "p2" });
  });

  it("rolls on every attack until failure, then uses normal damage", () => {
    const result = playTurn(
      makeGame(4),
      [8, 10, 6, 4],
      {
        p1: { type: "ATTACK", targetPlayerId: "p2" },
        p2: { type: "EVADE" },
        p3: { type: "ATTACK", targetPlayerId: "p2" },
        p4: { type: "ATTACK", targetPlayerId: "p2" },
      },
      { evade: [9, 2] },
    );
    expect(player(result.state, "p2").hp).toBe(
      MAX_HP - CRITICAL_DAMAGE - NORMAL_DAMAGE,
    );
    expect(
      result.events.filter((event) => event.type === "EVADE_ROLLED"),
    ).toHaveLength(2);
  });
});

describe("counter", () => {
  it("simultaneously applies 10 to the attacker and 2.5 to the counter user", () => {
    const result = playTurn(makeGame(2), [4, 9], {
      p1: { type: "ATTACK", targetPlayerId: "p2" },
      p2: { type: "COUNTER", targetPlayerId: "p1" },
    });
    expect(player(result.state, "p1").hp).toBe(MAX_HP - CRITICAL_DAMAGE);
    expect(player(result.state, "p2").hp).toBe(MAX_HP - REDUCED_DAMAGE);
    expect(result.events).toContainEqual({
      type: "COUNTER_TRIGGERED",
      counterPlayerId: "p2",
      attackerId: "p1",
    });
  });

  it("does not trigger before the counter action activates", () => {
    const result = playTurn(makeGame(2), [9, 1], {
      p1: { type: "ATTACK", targetPlayerId: "p2" },
      p2: { type: "COUNTER", targetPlayerId: "p1" },
    });
    expect(player(result.state, "p1").hp).toBe(MAX_HP);
    expect(player(result.state, "p2").hp).toBe(MAX_HP - NORMAL_DAMAGE);
    expect(result.events.some((event) => event.type === "COUNTER_TRIGGERED")).toBe(false);
  });

  it("ignores non-designated attackers and is consumed after one trigger", () => {
    const result = playTurn(makeGame(4), [8, 10, 9, 6], {
      p1: { type: "ATTACK", targetPlayerId: "p2" },
      p2: { type: "COUNTER", targetPlayerId: "p1" },
      p3: { type: "ATTACK", targetPlayerId: "p2" },
      p4: { type: "ATTACK", targetPlayerId: "p2" },
    });
    expect(player(result.state, "p2").hp).toBe(
      MAX_HP - NORMAL_DAMAGE - REDUCED_DAMAGE - NORMAL_DAMAGE,
    );
    expect(player(result.state, "p1").hp).toBe(MAX_HP - CRITICAL_DAMAGE);
    expect(
      result.events.filter((event) => event.type === "COUNTER_TRIGGERED"),
    ).toHaveLength(1);
  });

  it("forbids selecting counter on consecutive turns", () => {
    const first = playTurn(makeGame(2), [4, 9], {
      p1: { type: "ATTACK", targetPlayerId: "p2" },
      p2: { type: "COUNTER", targetPlayerId: "p1" },
    });
    const secondTurn = beginTurn(first.state, [5, 7]);
    expect(() =>
      submitAction(secondTurn, "p2", {
        type: "COUNTER",
        targetPlayerId: "p1",
      }),
    ).toThrow(/consecutive/);
  });
});

describe("death, skips, and game results", () => {
  it("cancels a dead player's action and never retargets an attack", () => {
    const initial = makeGame(3);
    const fragile: GameState = {
      ...initial,
      players: initial.players.map((candidate) =>
        candidate.id === "p3" ? { ...candidate, hp: NORMAL_DAMAGE } : candidate,
      ),
    };
    const result = playTurn(fragile, [10, 8, 1], {
      p1: { type: "ATTACK", targetPlayerId: "p3" },
      p2: { type: "ATTACK", targetPlayerId: "p3" },
      p3: { type: "DEFEND" },
    });
    expect(player(result.state, "p3").alive).toBe(false);
    expect(player(result.state, "p1").hp).toBe(MAX_HP);
    expect(result.events).toContainEqual({
      type: "ACTION_SKIPPED",
      playerId: "p2",
      reason: "TARGET_DEAD",
    });
    expect(result.events).toContainEqual({
      type: "ACTION_SKIPPED",
      playerId: "p3",
      reason: "DEAD",
    });
  });

  it("ends with a winner when one survivor remains", () => {
    const initial = makeGame(2);
    const fragile: GameState = {
      ...initial,
      players: initial.players.map((candidate) =>
        candidate.id === "p2" ? { ...candidate, hp: NORMAL_DAMAGE } : candidate,
      ),
    };
    const result = playTurn(fragile, [9, 1], {
      p1: { type: "ATTACK", targetPlayerId: "p2" },
      p2: { type: "DEFEND" },
    });
    expect(result.state.phase).toBe("FINISHED");
    expect(result.state.result).toEqual({ type: "WINNER", winnerPlayerId: "p1" });
    expect(result.events.at(-1)).toEqual({
      type: "GAME_FINISHED",
      result: { type: "WINNER", winnerPlayerId: "p1" },
    });
  });

  it("ends in a draw when simultaneous counter damage kills everyone", () => {
    const initial = makeGame(2);
    const fragile: GameState = {
      ...initial,
      players: initial.players.map((candidate) =>
        candidate.id === "p1"
          ? { ...candidate, hp: CRITICAL_DAMAGE }
          : { ...candidate, hp: REDUCED_DAMAGE },
      ),
    };
    const result = playTurn(fragile, [4, 9], {
      p1: { type: "ATTACK", targetPlayerId: "p2" },
      p2: { type: "COUNTER", targetPlayerId: "p1" },
    });
    expect(player(result.state, "p1").alive).toBe(false);
    expect(player(result.state, "p2").alive).toBe(false);
    expect(result.state.result).toEqual({ type: "DRAW" });
  });

  it("keeps the submitted state unchanged while resolving into a new state", () => {
    const started = beginTurn(makeGame(2), [9, 1]);
    const submitted = submitAll(started, {
      p1: { type: "ATTACK", targetPlayerId: "p2" },
      p2: { type: "DEFEND" },
    });
    const result = resolveTurn(submitted, new SeededRandomSource(1));
    expect(submitted.phase).toBe("RESOLVING");
    expect(player(submitted, "p2").hp).toBe(MAX_HP);
    expect(player(result.state, "p2").hp).toBe(MAX_HP - NORMAL_DAMAGE);
  });
});

describe("random sources", () => {
  it("replays explicit sequence values and validates their range", () => {
    const source = new SequenceRandomSource([3, 9]);
    expect(source.nextInt(1, 10)).toBe(3);
    expect(source.nextInt(1, 10)).toBe(9);
    expect(() => source.nextInt(1, 10)).toThrow(/ran out/);
    expect(() => new SequenceRandomSource([11]).nextInt(1, 10)).toThrow(
      /outside/,
    );
  });

  it("produces the same sequence for the same seed", () => {
    const first = new SeededRandomSource(1234);
    const second = new SeededRandomSource(1234);
    expect(Array.from({ length: 8 }, () => first.nextInt(1, 10))).toEqual(
      Array.from({ length: 8 }, () => second.nextInt(1, 10)),
    );
  });
});
