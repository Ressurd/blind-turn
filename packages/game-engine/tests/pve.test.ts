import { describe, expect, it } from "vitest";
import {
  PVE_BOARD_HEIGHT,
  PVE_BOARD_WIDTH,
  createInitialPveBattleState,
  createPveBossPlan,
  createPassPvePlans,
  getPveActionPreview,
  getPveAttackGeometry,
  getPvePlannedActionOrder,
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

describe("PvE action preview", () => {
  it("uses a 6 column by 4 row board and excludes out-of-bounds movement", () => {
    expect(PVE_BOARD_WIDTH).toBe(6);
    expect(PVE_BOARD_HEIGHT).toBe(4);
    const preview = getPveActionPreview(
      createInitialPveBattleState(),
      createPassPvePlans(),
      "WARRIOR",
      1,
      "WARRIOR_MOVE",
    );
    expect(preview.selectableTiles.every((tile) =>
      tile.x >= 0 && tile.x < 6 && tile.y >= 0 && tile.y < 4
    )).toBe(true);
    expect(new Set(Array.from({ length: PVE_BOARD_HEIGHT }, (_, y) =>
      Array.from({ length: PVE_BOARD_WIDTH }, (_, x) => `${x}:${y}`)
    ).flat()).size).toBe(24);
  });

  it("excludes occupied tiles from normal movement", () => {
    const state = createInitialPveBattleState();
    state.characters.MAGE.position = { x: 3, y: 1 };
    const preview = getPveActionPreview(
      state,
      createPassPvePlans(),
      "WARRIOR",
      1,
      "WARRIOR_MOVE",
    );
    expect(preview.selectableTiles).not.toContainEqual({ x: 3, y: 1 });
  });

  it("returns teleport destinations from the engine movement rule", () => {
    const preview = getPveActionPreview(
      createInitialPveBattleState(),
      createPassPvePlans(),
      "MAGE",
      1,
      "MAGE_TELEPORT",
    );
    expect(preview.selectableTiles).toContainEqual({ x: 3, y: 2 });
    expect(preview.selectableTiles).not.toContainEqual({ x: 4, y: 2 });
    expect(preview.selectableTiles).not.toContainEqual({ x: 0, y: 3 });
  });

  it("projects an action two attack origin after action one movement", () => {
    const plans = createPassPvePlans();
    planAction(plans, "WARRIOR", 1, {
      actionId: "WARRIOR_MOVE",
      target: { type: "TILE", position: { x: 3, y: 1 } },
    });
    const preview = getPveActionPreview(
      createInitialPveBattleState(),
      plans,
      "WARRIOR",
      2,
      "WARRIOR_SLASH",
    );
    expect(preview.originPosition).toEqual({ x: 3, y: 1 });
    expect(preview.effectTiles).toEqual([{ x: 4, y: 1 }]);
  });

  it("projects an action three attack origin after two movements", () => {
    const plans = createPassPvePlans();
    planAction(plans, "WARRIOR", 1, {
      actionId: "WARRIOR_MOVE",
      target: { type: "TILE", position: { x: 3, y: 1 } },
    });
    planAction(plans, "WARRIOR", 2, {
      actionId: "WARRIOR_MOVE",
      target: { type: "TILE", position: { x: 2, y: 1 } },
    });
    const preview = getPveActionPreview(
      createInitialPveBattleState(),
      plans,
      "WARRIOR",
      3,
      "WARRIOR_SLASH",
    );
    expect(preview.originPosition).toEqual({ x: 2, y: 1 });
    expect(preview.effectTiles).toEqual([{ x: 3, y: 1 }]);
  });

  it("matches fixed attack geometry from the projected engine state", () => {
    const state = createInitialPveBattleState();
    state.characters.MAGE.position = { x: 2, y: 2 };
    const preview = getPveActionPreview(
      state,
      createPassPvePlans(),
      "MAGE",
      1,
      "MAGE_LIGHTNING",
    );
    expect(preview.effectTiles).toEqual(
      getPveAttackGeometry(state, "MAGE", "MAGE_LIGHTNING").effectArea,
    );
  });

  it("returns tile attack centers and their selected effect area", () => {
    const state = createInitialPveBattleState();
    state.characters.MAGE.position = { x: 3, y: 2 };
    const preview = getPveActionPreview(
      state,
      createPassPvePlans(),
      "MAGE",
      1,
      "MAGE_FIREBALL",
      { type: "TILE", position: { x: 5, y: 2 } },
    );
    expect(preview.selectableTiles).toContainEqual({ x: 5, y: 2 });
    expect(preview.effectTiles).toEqual(expect.arrayContaining([
      { x: 5, y: 2 },
      { x: 6, y: 2 },
      { x: 5, y: 1 },
      { x: 5, y: 3 },
    ]));
  });

  it("predicts one boss hit when one or both occupied tiles overlap", () => {
    const state = createInitialPveBattleState();
    state.characters.WARRIOR.position = { x: 5, y: 1 };
    state.characters.ARCHER.position = { x: 3, y: 1 };
    const slash = getPveActionPreview(
      state,
      createPassPvePlans(),
      "WARRIOR",
      1,
      "WARRIOR_SLASH",
    );
    const rain = getPveActionPreview(
      state,
      createPassPvePlans(),
      "ARCHER",
      1,
      "ARCHER_ARROW_RAIN",
      { type: "TILE", position: { x: 6, y: 1 } },
    );
    expect(slash.willHitBoss).toBe(true);
    expect(rain.willHitBoss).toBe(true);
    expect(rain.predictedTargetIds).toEqual(["TRAINING_GOLEM"]);
  });

  it("returns only living allies as support targets", () => {
    const state = createInitialPveBattleState();
    state.characters.ARCHER.alive = false;
    state.characters.ARCHER.hp = 0;
    const preview = getPveActionPreview(
      state,
      createPassPvePlans(),
      "PRIEST",
      1,
      "PRIEST_HEAL",
    );
    expect(preview.selectableCharacterIds).toEqual(["WARRIOR", "MAGE", "PRIEST"]);
    expect(preview.selectableCharacterIds).not.toContain("ARCHER");
  });

  it("does not mutate plans or change deterministic combat results", () => {
    const state = createInitialPveBattleState();
    const plans = createPassPvePlans();
    planAction(plans, "MAGE", 1, { actionId: "MAGE_LIGHTNING" });
    const stateBefore = structuredClone(state);
    const plansBefore = structuredClone(plans);
    const expected = resolvePveTurn(state, plans);
    getPveActionPreview(state, plans, "MAGE", 1, "MAGE_LIGHTNING");
    expect(resolvePveTurn(state, plans)).toEqual(expected);
    expect(state).toEqual(stateBefore);
    expect(plans).toEqual(plansBefore);
  });
});

describe("PvE deterministic boss pattern cycle", () => {
  it("builds the 1, 2, 3 pattern sets and repeats them", () => {
    const state = createInitialPveBattleState();
    expect(createPveBossPlan(1, state).map((intent) => intent.id)).toEqual([
      "COLUMN_SMASH", "TRACKING_BOLT", "EARTH_QUAKE",
    ]);
    expect(createPveBossPlan(2, state).map((intent) => intent.id)).toEqual([
      "UPPER_COLLAPSE", "MELEE_SMASH", "FRACTURE_EXPLOSION",
    ]);
    expect(createPveBossPlan(3, state).map((intent) => intent.id)).toEqual([
      "CENTER_CRUSH", "WEAKNESS_TRACKING", "HEAVY_EARTH_QUAKE",
    ]);
    expect(createPveBossPlan(4, state).map((intent) => intent.id)).toEqual(
      createPveBossPlan(1, state).map((intent) => intent.id),
    );
  });

  it("locks preview targets and tiles at planning start", () => {
    const state = createInitialPveBattleState();
    state.characters.ARCHER.hp = 1;
    const second = createPveBossPlan(2, state);
    const third = createPveBossPlan(3, state);
    expect(second[1].targetCharacterIds).toEqual(["WARRIOR"]);
    expect(second[2].targetCharacterIds).toEqual(["WARRIOR", "ARCHER"]);
    expect(second[2].targetTiles).toEqual([{ x: 4, y: 1 }, { x: 0, y: 0 }]);
    expect(third[1].targetCharacterIds).toEqual(["ARCHER"]);
  });

  it("resolves each pattern from the supplied server plan deterministically", () => {
    const state = createInitialPveBattleState();
    const plans = createPassPvePlans();
    const bossPlan = createPveBossPlan(2, state);
    const left = resolvePveTurn(state, plans, bossPlan);
    const right = resolvePveTurn(state, plans, bossPlan);
    expect(left).toEqual(right);
    expect(damageEvents(left, 1).map((event) => event.targetCharacterId)).toEqual([
      "WARRIOR", "ARCHER",
    ]);
    expect(damageEvents(left, 2)[0]).toEqual(expect.objectContaining({
      targetCharacterId: "WARRIOR",
      rawAmount: 7,
    }));
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
    planAction(plans, "MAGE", 1, {
      actionId: "MAGE_MOVE",
      target: { type: "TILE", position: { x: 2, y: 2 } },
    });
    planAction(plans, "MAGE", 2, {
      actionId: "MAGE_FIREBALL",
      target: { type: "TILE", position: { x: 5, y: 2 } },
    });
    const result = resolvePveTurn(createInitialPveBattleState(), plans);
    expect(result.events).toContainEqual(expect.objectContaining({
      beat: 2,
      type: "BOSS_DAMAGED",
      actorId: "MAGE",
      rawAmount: 5,
      amount: 6,
      damageType: "MAGIC",
    }));
    expect(result.state.boss.hp).toBe(74);
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
    expect(result.timeline).toContainEqual(expect.objectContaining({
      beat: 2,
      actorId: "WARRIOR",
      actionId: "WARRIOR_SLASH",
      status: "SKIPPED",
    }));
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

describe("PvE action timeline", () => {
  it("uses the resolver's phase and character order for planning and playback", () => {
    const plans = createPassPvePlans();
    planAction(plans, "WARRIOR", 1, { actionId: "WARRIOR_TAUNT" });
    planAction(plans, "ARCHER", 1, {
      actionId: "ARCHER_MOVE",
      target: { type: "TILE", position: { x: 1, y: 0 } },
    });
    planAction(plans, "MAGE", 1, {
      actionId: "MAGE_FIREBALL",
      target: { type: "TILE", position: { x: 4, y: 2 } },
    });
    planAction(plans, "PRIEST", 1, {
      actionId: "PRIEST_GUARD",
      target: { type: "ALLY", characterId: "WARRIOR" },
    });

    const expected = getPvePlannedActionOrder(plans, 1);
    const result = resolvePveTurn(createInitialPveBattleState(), plans);
    expect(expected.map((entry) => [entry.actorId, entry.phase])).toEqual([
      ["WARRIOR", "PREPARE"],
      ["PRIEST", "PREPARE"],
      ["ARCHER", "MOVE"],
      ["MAGE", "ATTACK"],
      ["BOSS", "BOSS"],
    ]);
    expect(result.timeline.filter((entry) => entry.beat === 1).map((entry) => entry.id))
      .toEqual(expected.map((entry) => entry.id));
  });

  it("marks failed movement as skipped without changing later event order", () => {
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
    const mageMove = result.timeline.find((entry) =>
      entry.beat === 1 && entry.actorId === "MAGE"
    );
    expect(mageMove).toEqual(expect.objectContaining({
      status: "SKIPPED",
      startEventIndex: expect.any(Number),
      endEventIndex: expect.any(Number),
    }));
    expect(mageMove?.skipReason).toContain("이동 실패");
    expect(result.timeline.find((entry) =>
      entry.beat === 1 && entry.actorId === "BOSS"
    )?.startEventIndex).toBeGreaterThan(mageMove?.endEventIndex ?? -1);
  });
});

describe("PvE tile attack geometry", () => {
  it("models the boss as one enemy occupying two virtual tiles", () => {
    const state = createInitialPveBattleState();
    expect(state.boss.occupiedTiles).toEqual([
      { x: 6, y: 1 },
      { x: 6, y: 2 },
    ]);
  });

  it("recomputes Slash after movement and only hits from x=5", () => {
    const plans = createPassPvePlans();
    planAction(plans, "WARRIOR", 1, {
      actionId: "WARRIOR_MOVE",
      target: { type: "TILE", position: { x: 5, y: 1 } },
    });
    planAction(plans, "WARRIOR", 2, { actionId: "WARRIOR_SLASH" });

    const result = resolvePveTurn(createInitialPveBattleState(), plans);
    expect(result.events).toContainEqual(expect.objectContaining({
      beat: 2,
      type: "BOSS_DAMAGED",
      actionId: "WARRIOR_SLASH",
      amount: 5,
      effectArea: [{ x: 6, y: 1 }],
      hitEnemyIds: ["TRAINING_GOLEM"],
    }));
    expect(result.state.boss.hp).toBe(75);
  });

  it("validates a selected attack center against the projected execution origin", () => {
    const state = createInitialPveBattleState();
    const plans = createPassPvePlans();
    planAction(plans, "MAGE", 1, {
      actionId: "MAGE_MOVE",
      target: { type: "TILE", position: { x: 2, y: 2 } },
    });
    const action: PvePlannedAction = {
      actionId: "MAGE_FIREBALL",
      target: { type: "TILE", position: { x: 5, y: 2 } },
    };

    expect(validatePvePlannedAction(state, plans, "MAGE", 2, action))
      .toEqual({ valid: true });
    expect(validatePvePlannedAction(state, plans, "MAGE", 1, action).valid)
      .toBe(false);
  });

  it("damages a multi-tile enemy only once with Sweep", () => {
    const state = createInitialPveBattleState();
    state.characters.WARRIOR.position = { x: 5, y: 1 };
    const plans = planAction(createPassPvePlans(), "WARRIOR", 1, {
      actionId: "WARRIOR_SWEEP",
    });

    const result = resolvePveTurn(state, plans);
    const sweepDamage = result.events.filter((event) =>
      event.type === "BOSS_DAMAGED" && event.actionId === "WARRIOR_SWEEP"
    );
    expect(sweepDamage).toHaveLength(1);
    expect(sweepDamage[0]).toEqual(expect.objectContaining({
      rawAmount: 3,
      hitEnemyIds: ["TRAINING_GOLEM"],
    }));
    expect(result.state.boss.hp).toBe(77);
  });

  it("stops Archer Shot at the first blocking unit", () => {
    const state = createInitialPveBattleState();
    state.characters.ARCHER.position = { x: 2, y: 1 };
    state.characters.WARRIOR.position = { x: 4, y: 1 };
    const geometry = getPveAttackGeometry(state, "ARCHER", "ARCHER_SHOT");

    expect(geometry.useRange).toEqual([
      { x: 3, y: 1 },
      { x: 4, y: 1 },
      { x: 5, y: 1 },
      { x: 6, y: 1 },
    ]);
    expect(geometry.effectArea).toEqual([{ x: 3, y: 1 }, { x: 4, y: 1 }]);
    expect(geometry.hitEnemyIds).toEqual([]);
  });

  it("lets Archer Shot hit when its line is clear", () => {
    const state = createInitialPveBattleState();
    state.characters.ARCHER.position = { x: 2, y: 1 };
    state.characters.WARRIOR.position = { x: 4, y: 0 };
    const geometry = getPveAttackGeometry(state, "ARCHER", "ARCHER_SHOT");

    expect(geometry.effectArea).toEqual([
      { x: 3, y: 1 },
      { x: 4, y: 1 },
      { x: 5, y: 1 },
      { x: 6, y: 1 },
    ]);
    expect(geometry.hitEnemyIds).toEqual(["TRAINING_GOLEM"]);
  });

  it("uses Retreat Shot's post-move position as its attack origin", () => {
    const state = createInitialPveBattleState();
    state.characters.ARCHER.position = { x: 5, y: 1 };
    state.characters.WARRIOR.position = { x: 3, y: 1 };
    const plans = planAction(createPassPvePlans(), "ARCHER", 1, {
      actionId: "ARCHER_RETREAT_SHOT",
    });

    const result = resolvePveTurn(state, plans);
    expect(result.events).toContainEqual(expect.objectContaining({
      beat: 1,
      type: "MOVED",
      actionId: "ARCHER_RETREAT_SHOT",
      to: { x: 4, y: 1 },
    }));
    expect(result.events).toContainEqual(expect.objectContaining({
      beat: 1,
      type: "BOSS_DAMAGED",
      actionId: "ARCHER_RETREAT_SHOT",
      rawAmount: 3,
      effectArea: [{ x: 5, y: 1 }, { x: 6, y: 1 }],
    }));
  });

  it("separates selected centers from Arrow Rain and Fireball effect areas", () => {
    const state = createInitialPveBattleState();
    state.characters.ARCHER.position = { x: 3, y: 1 };
    state.characters.MAGE.position = { x: 3, y: 2 };

    const rain = getPveAttackGeometry(
      state,
      "ARCHER",
      "ARCHER_ARROW_RAIN",
      { x: 6, y: 1 },
    );
    const fireball = getPveAttackGeometry(
      state,
      "MAGE",
      "MAGE_FIREBALL",
      { x: 5, y: 2 },
    );

    expect(rain.selectedCenter).toEqual({ x: 6, y: 1 });
    expect(rain.effectArea).toEqual([
      { x: 6, y: 1 },
      { x: 6, y: 2 },
    ]);
    expect(rain.hitEnemyIds).toEqual(["TRAINING_GOLEM"]);
    expect(fireball.useRange).toContainEqual({ x: 6, y: 2 });
    expect(fireball.effectArea).toContainEqual({ x: 6, y: 2 });
    expect(fireball.hitEnemyIds).toEqual(["TRAINING_GOLEM"]);
  });

  it("supports piercing Lightning and two-tile Holy Light", () => {
    const state = createInitialPveBattleState();
    state.characters.MAGE.position = { x: 1, y: 2 };
    state.characters.PRIEST.position = { x: 4, y: 1 };

    const lightning = getPveAttackGeometry(state, "MAGE", "MAGE_LIGHTNING");
    const holyLight = getPveAttackGeometry(state, "PRIEST", "PRIEST_HOLY_LIGHT");

    expect(lightning.effectArea.at(-1)).toEqual({ x: 6, y: 2 });
    expect(lightning.hitEnemyIds).toEqual(["TRAINING_GOLEM"]);
    expect(holyLight.effectArea).toEqual([{ x: 5, y: 1 }, { x: 6, y: 1 }]);
    expect(holyLight.hitEnemyIds).toEqual(["TRAINING_GOLEM"]);
  });

  it("consumes and logs an attack when no enemy occupies its effect area", () => {
    const plans = planAction(createPassPvePlans(), "WARRIOR", 1, {
      actionId: "WARRIOR_SLASH",
    });
    const result = resolvePveTurn(createInitialPveBattleState(), plans);

    expect(result.events).toContainEqual(expect.objectContaining({
      beat: 1,
      type: "ATTACK_MISSED",
      actionId: "WARRIOR_SLASH",
      effectArea: [{ x: 5, y: 1 }],
      hitEnemyIds: [],
    }));
    expect(result.state.boss.hp).toBe(80);
  });
});
