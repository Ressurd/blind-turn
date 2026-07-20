import { describe, expect, it } from "vitest";
import {
  createInitialPveBattleState,
  createPassPvePlans,
  resolvePveTurn,
  validatePvePlannedAction,
  type PveBattleState,
  type PveBeat,
  type PveCharacterId,
  type PvePlannedAction,
  type PvePlans,
} from "../src";

function planAction(
  plans: PvePlans,
  characterId: PveCharacterId,
  beat: PveBeat,
  action: PvePlannedAction,
): PvePlans {
  plans[characterId][beat - 1] = action;
  return plans;
}

function damageEvents(result: ReturnType<typeof resolvePveTurn>, beat: PveBeat) {
  return result.events.filter((event) =>
    event.beat === beat && event.type === "CHARACTER_DAMAGED"
  );
}

describe("PvE movement validation", () => {
  it("rejects movement outside the 6x4 board", () => {
    const state = createInitialPveBattleState();
    const plans = createPassPvePlans();
    const result = validatePvePlannedAction(state, plans, "ARCHER", 1, {
      actionId: "ARCHER_MOVE",
      target: { type: "TILE", position: { x: -1, y: 0 } },
    });
    expect(result).toEqual({
      valid: false,
      reason: "전장 밖으로 이동할 수 없습니다.",
    });
  });

  it("rejects an occupied destination", () => {
    const state = createInitialPveBattleState();
    state.characters.MAGE.position = { x: 3, y: 1 };
    const result = validatePvePlannedAction(
      state,
      createPassPvePlans(),
      "WARRIOR",
      1,
      {
        actionId: "WARRIOR_MOVE",
        target: { type: "TILE", position: { x: 3, y: 1 } },
      },
    );
    expect(result.valid).toBe(false);
  });

  it("allows teleporting through another character", () => {
    const state = createInitialPveBattleState();
    state.characters.WARRIOR.position = { x: 2, y: 2 };
    const plans = planAction(createPassPvePlans(), "MAGE", 1, {
      actionId: "MAGE_TELEPORT",
      target: { type: "TILE", position: { x: 3, y: 2 } },
    });
    const validation = validatePvePlannedAction(
      state,
      plans,
      "MAGE",
      1,
      plans.MAGE[0]!,
    );
    expect(validation).toEqual({ valid: true });
    expect(resolvePveTurn(state, plans).state.characters.MAGE.position).toEqual({
      x: 3,
      y: 2,
    });
  });

  it("logs a later same-beat movement collision without stopping the turn", () => {
    const state = createInitialPveBattleState();
    state.characters.MAGE.position = { x: 3, y: 2 };
    const plans = createPassPvePlans();
    planAction(plans, "WARRIOR", 1, {
      actionId: "WARRIOR_MOVE",
      target: { type: "TILE", position: { x: 3, y: 1 } },
    });
    planAction(plans, "MAGE", 1, {
      actionId: "MAGE_MOVE",
      target: { type: "TILE", position: { x: 3, y: 1 } },
    });
    const result = resolvePveTurn(state, plans);
    expect(result.state.characters.WARRIOR.position).toEqual({ x: 3, y: 1 });
    expect(result.state.characters.MAGE.position).toEqual({ x: 3, y: 2 });
    expect(result.events).toContainEqual(expect.objectContaining({
      beat: 1,
      type: "ACTION_FAILED",
      actorId: "MAGE",
    }));
    expect(result.events.at(-1)?.type).toBe("TURN_FINISHED");
  });
});

describe("PvE boss intents and mitigation", () => {
  it("hits only characters in x=4 with Column Smash", () => {
    const result = resolvePveTurn(
      createInitialPveBattleState(),
      createPassPvePlans(),
    );
    expect(damageEvents(result, 1).map((event) => event.targetCharacterId))
      .toEqual(["WARRIOR"]);
    expect(damageEvents(result, 1)[0]).toEqual(expect.objectContaining({
      rawAmount: 5,
      amount: 5,
    }));
  });

  it("redirects Tracking Bolt to a taunting Warrior", () => {
    const plans = planAction(createPassPvePlans(), "WARRIOR", 2, {
      actionId: "WARRIOR_TAUNT",
    });
    const result = resolvePveTurn(createInitialPveBattleState(), plans);
    expect(result.trackingTargetId).toBe("ARCHER");
    expect(damageEvents(result, 2)).toContainEqual(expect.objectContaining({
      targetCharacterId: "WARRIOR",
      rawAmount: 6,
    }));
  });

  it("does not redirect fixed-tile or all-party attacks with taunt", () => {
    const state = createInitialPveBattleState();
    state.characters.WARRIOR.position = { x: 3, y: 1 };
    state.characters.ARCHER.position = { x: 4, y: 0 };
    const plans = createPassPvePlans();
    planAction(plans, "WARRIOR", 1, { actionId: "WARRIOR_TAUNT" });
    planAction(plans, "WARRIOR", 3, { actionId: "WARRIOR_TAUNT" });
    const result = resolvePveTurn(state, plans);
    expect(damageEvents(result, 1).map((event) => event.targetCharacterId))
      .toEqual(["ARCHER"]);
    expect(damageEvents(result, 3).map((event) => event.targetCharacterId))
      .toEqual(["WARRIOR", "ARCHER", "MAGE", "PRIEST"]);
  });

  it("caps combined Defend and Guard reduction at 75%", () => {
    const plans = createPassPvePlans();
    planAction(plans, "WARRIOR", 3, { actionId: "WARRIOR_DEFEND" });
    planAction(plans, "PRIEST", 3, {
      actionId: "PRIEST_GUARD",
      target: { type: "ALLY", characterId: "WARRIOR" },
    });
    const result = resolvePveTurn(createInitialPveBattleState(), plans);
    expect(damageEvents(result, 3)).toContainEqual(expect.objectContaining({
      targetCharacterId: "WARRIOR",
      rawAmount: 4,
      reductionRate: 0.75,
      amount: 1,
    }));
  });

  it("applies a shield before HP damage", () => {
    const plans = planAction(createPassPvePlans(), "MAGE", 1, {
      actionId: "MAGE_SHIELD",
      target: { type: "ALLY", characterId: "WARRIOR" },
    });
    const result = resolvePveTurn(createInitialPveBattleState(), plans);
    expect(damageEvents(result, 1)).toContainEqual(expect.objectContaining({
      targetCharacterId: "WARRIOR",
      rawAmount: 5,
      shieldAbsorbed: 5,
      amount: 0,
    }));
  });
});

describe("PvE support, attack, and deterministic resolution", () => {
  it("never heals above max HP", () => {
    const state = createInitialPveBattleState();
    state.characters.WARRIOR.hp = 28;
    state.characters.WARRIOR.position = { x: 3, y: 1 };
    const plans = planAction(createPassPvePlans(), "PRIEST", 1, {
      actionId: "PRIEST_HEAL",
      target: { type: "ALLY", characterId: "WARRIOR" },
    });
    const result = resolvePveTurn(state, plans);
    expect(result.events).toContainEqual(expect.objectContaining({
      beat: 1,
      type: "HEALED",
      targetCharacterId: "WARRIOR",
      amount: 2,
    }));
  });

  it("increases attacks after Mark and rounds to an integer", () => {
    const plans = createPassPvePlans();
    planAction(plans, "ARCHER", 1, { actionId: "ARCHER_MARK" });
    planAction(plans, "MAGE", 1, { actionId: "MAGE_FIREBALL" });
    const result = resolvePveTurn(createInitialPveBattleState(), plans);
    expect(result.events).toContainEqual(expect.objectContaining({
      beat: 1,
      type: "BOSS_DAMAGED",
      actorId: "MAGE",
      rawAmount: 6,
      amount: 8,
      damageType: "MAGIC",
    }));
    expect(result.state.boss.hp).toBe(72);
  });

  it("skips later actions from a dead character", () => {
    const state = createInitialPveBattleState();
    state.characters.WARRIOR.hp = 5;
    const plans = planAction(createPassPvePlans(), "WARRIOR", 2, {
      actionId: "WARRIOR_SLASH",
    });
    const result = resolvePveTurn(state, plans);
    expect(result.state.characters.WARRIOR.alive).toBe(false);
    expect(result.events.some((event) =>
      event.beat === 2
      && event.type === "BOSS_DAMAGED"
      && event.actorId === "WARRIOR"
    )).toBe(false);
    expect(result.state.boss.hp).toBe(80);
  });

  it("returns the same state and events for the same input", () => {
    const state: PveBattleState = createInitialPveBattleState();
    const plans = createPassPvePlans();
    planAction(plans, "WARRIOR", 1, { actionId: "WARRIOR_SLASH" });
    planAction(plans, "ARCHER", 1, { actionId: "ARCHER_MARK" });
    const first = resolvePveTurn(state, plans);
    const second = resolvePveTurn(state, plans);
    expect(second).toEqual(first);
    expect(state).toEqual(createInitialPveBattleState());
  });
});
