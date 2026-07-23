import {
  isPvePlanComplete,
  PVE_ACTIONS,
  PVE_BOSS_INTENTS,
  PVE_CHARACTER_ORDER,
  selectPveTrackingTarget,
} from "./fixtures";
import {
  buildPveResolvedActionTimeline,
  getPvePlannedActionOrder,
} from "./action-order";
import { getPveAttackGeometry } from "./attack-range";
import type {
  PveActionDefinition,
  PveActionOrderEntry,
  PveBattleState,
  PveBeat,
  PveBossPlan,
  PveCharacterId,
  PveCombatEvent,
  PveCombatEventType,
  PvePlans,
  PvePosition,
  PveResolutionPhase,
  PveTurnResolution,
} from "./types";
import { validatePveMove } from "./validation";

type EventInput = {
  type: PveCombatEventType;
  phase: PveResolutionPhase;
  message: string;
  timelineEntryId?: string;
  actionName?: string;
  skipReason?: string;
  actorId?: PveCharacterId | "BOSS" | "SYSTEM";
  targetCharacterId?: PveCharacterId;
  actionId?: PveCombatEvent["actionId"];
  targetEnemyId?: PveCombatEvent["targetEnemyId"];
  damageType?: PveCombatEvent["damageType"];
  amount?: number;
  rawAmount?: number;
  reductionRate?: number;
  shieldAbsorbed?: number;
  from?: PvePosition;
  to?: PvePosition;
  selectedCenter?: PvePosition;
  effectArea?: PvePosition[];
  hitEnemyIds?: PveCombatEvent["hitEnemyIds"];
};

type BeatContext = {
  trackingTargetId: PveCharacterId;
  taunting: boolean;
  reductions: Map<PveCharacterId, number>;
  retreatSucceeded: boolean;
};

function clonePveBattleState(state: PveBattleState): PveBattleState {
  return {
    characters: {
      WARRIOR: { ...state.characters.WARRIOR, position: { ...state.characters.WARRIOR.position } },
      ARCHER: { ...state.characters.ARCHER, position: { ...state.characters.ARCHER.position } },
      MAGE: { ...state.characters.MAGE, position: { ...state.characters.MAGE.position } },
      PRIEST: { ...state.characters.PRIEST, position: { ...state.characters.PRIEST.position } },
    },
    boss: {
      ...state.boss,
      occupiedTiles: state.boss.occupiedTiles.map((position) => ({ ...position })),
    },
    result: state.result,
  };
}

function positionsFromState(
  state: PveBattleState,
): Record<PveCharacterId, PvePosition> {
  return {
    WARRIOR: state.characters.WARRIOR.position,
    ARCHER: state.characters.ARCHER.position,
    MAGE: state.characters.MAGE.position,
    PRIEST: state.characters.PRIEST.position,
  };
}

function resolveBeatInternal(
  input: PveBattleState,
  plans: PvePlans,
  beat: PveBeat,
  trackingTargetId: PveCharacterId,
  eventOffset: number,
  bossPlan: PveBossPlan,
): {
  state: PveBattleState;
  events: PveCombatEvent[];
  actionOrder: PveActionOrderEntry[];
} {
  const state = clonePveBattleState(input);
  const events: PveCombatEvent[] = [];
  const actionOrder = getPvePlannedActionOrder(plans, beat, bossPlan);
  let activeTimelineEntryId: string | null = null;
  const context: BeatContext = {
    trackingTargetId,
    taunting: false,
    reductions: new Map(),
    retreatSucceeded: false,
  };

  const emit = (event: EventInput): void => {
    const timelineEntryId = event.timelineEntryId ?? activeTimelineEntryId;
    events.push({
      id: `beat-${beat}-event-${eventOffset + events.length + 1}`,
      beat,
      ...event,
      ...(timelineEntryId ? { timelineEntryId } : {}),
      state: clonePveBattleState(state),
    });
  };

  const actionFor = (characterId: PveCharacterId) => plans[characterId][beat - 1]!;
  const skipAction = (entry: PveActionOrderEntry, reason: string): void => {
    emit({
      type: "ACTION_FAILED",
      phase: entry.phase,
      actorId: entry.actorId,
      ...(entry.actionId ? { actionId: entry.actionId } : {}),
      actionName: entry.actionName,
      timelineEntryId: entry.id,
      skipReason: reason,
      message: reason,
    });
  };
  const runAction = (
    entry: PveActionOrderEntry,
    callback: (definition: PveActionDefinition) => void,
  ): void => {
    if (entry.actorId === "BOSS" || !entry.actionId) return;
    const characterId = entry.actorId;
    const character = state.characters[characterId];
    const action = actionFor(characterId);
    const definition = PVE_ACTIONS[action.actionId];
    if (!character.alive) {
      skipAction(entry, `${character.name}은(는) 쓰러져 행동할 수 없습니다.`);
      return;
    }
    const selectedCenter = action.target?.type === "TILE"
      ? action.target.position
      : undefined;
    const attackGeometry = definition.attackPattern
      ? getPveAttackGeometry(state, characterId, definition.id, selectedCenter)
      : null;
    activeTimelineEntryId = entry.id;
    try {
      emit({
        type: "ACTION_STARTED",
        phase: entry.phase,
        actorId: characterId,
        actionId: definition.id,
        actionName: entry.actionName,
        ...(selectedCenter ? { selectedCenter } : {}),
        ...(attackGeometry
          ? {
            effectArea: attackGeometry.effectArea,
            hitEnemyIds: attackGeometry.hitEnemyIds,
          }
          : {}),
        message: `${character.name}: ${entry.actionName}`,
      });
      callback(definition);
    } finally {
      activeTimelineEntryId = null;
    }
  };

  emit({
    type: "BEAT_STARTED",
    phase: "STATUS",
    actorId: "SYSTEM",
    message: `${beat} 비트 시작`,
  });

  for (const entry of actionOrder.filter((item) => item.segment === "PASS")) {
    if (entry.actorId === "BOSS") continue;
    const character = state.characters[entry.actorId];
    if (!character.alive) {
      skipAction(entry, `${character.name}은(는) 쓰러져 PASS할 수 없습니다.`);
    } else {
      emit({
        type: "ACTION_PASSED",
        phase: "PREPARE",
        actorId: entry.actorId,
        actionId: "PASS",
        actionName: entry.actionName,
        timelineEntryId: entry.id,
        message: `${character.name}: PASS`,
      });
    }
  }

  for (const entry of actionOrder.filter((item) =>
    item.phase === "PREPARE" && item.segment === "PRIMARY"
  )) {
    runAction(entry, (definition) => {
      if (entry.actorId === "BOSS") return;
      const characterId = entry.actorId;
      const action = actionFor(characterId);
      if (definition.id === "WARRIOR_TAUNT") {
        context.taunting = true;
        emit({
          type: "TAUNT_APPLIED",
          phase: "PREPARE",
          actorId: "WARRIOR",
          actionId: definition.id,
          message: "전사가 도발 태세를 취했습니다.",
        });
      } else if (definition.id === "WARRIOR_DEFEND") {
        context.reductions.set("WARRIOR", 0.5);
        emit({
          type: "DAMAGE_REDUCTION_APPLIED",
          phase: "PREPARE",
          actorId: "WARRIOR",
          targetCharacterId: "WARRIOR",
          actionId: definition.id,
          amount: 50,
          message: "전사의 이번 비트 피해 감소율이 50%가 되었습니다.",
        });
      } else if (definition.id === "MAGE_SHIELD" && action.target?.type === "ALLY") {
        const target = state.characters[action.target.characterId];
        if (!target.alive) {
          emit({
            type: "ACTION_FAILED",
            phase: "PREPARE",
            actorId: characterId,
            actionId: definition.id,
            message: "보호막 대상이 생존해 있지 않아 행동이 실패했습니다.",
          });
          return;
        }
        target.shield += definition.value ?? 5;
        emit({
          type: "SHIELD_GRANTED",
          phase: "PREPARE",
          actorId: characterId,
          targetCharacterId: target.id,
          actionId: definition.id,
          amount: definition.value ?? 5,
          message: `${target.name}에게 보호막 ${definition.value ?? 5}를 부여했습니다.`,
        });
      } else if (definition.id === "PRIEST_GUARD" && action.target?.type === "ALLY") {
        const target = state.characters[action.target.characterId];
        if (!target.alive) {
          emit({
            type: "ACTION_FAILED",
            phase: "PREPARE",
            actorId: characterId,
            actionId: definition.id,
            message: "수호 대상이 생존해 있지 않아 행동이 실패했습니다.",
          });
          return;
        }
        context.reductions.set(
          target.id,
          Math.min(0.75, (context.reductions.get(target.id) ?? 0) + 0.5),
        );
        emit({
          type: "DAMAGE_REDUCTION_APPLIED",
          phase: "PREPARE",
          actorId: characterId,
          targetCharacterId: target.id,
          actionId: definition.id,
          amount: 50,
          message: `${target.name}에게 수호를 적용했습니다.`,
        });
      }
    });
  }

  for (const entry of actionOrder.filter((item) =>
    item.phase === "MOVE" && item.segment === "PRIMARY"
  )) {
    runAction(entry, (definition) => {
      if (entry.actorId === "BOSS") return;
      const characterId = entry.actorId;
      const character = state.characters[characterId];
      const action = actionFor(characterId);
      let destination: PvePosition | null = null;
      let moveDefinition = definition;
      if (definition.id === "ARCHER_RETREAT_SHOT") {
        destination = {
          x: character.position.x - 1,
          y: character.position.y,
        };
        moveDefinition = PVE_ACTIONS.ARCHER_MOVE;
      } else if (action.target?.type === "TILE") {
        destination = action.target.position;
      }
      if (!destination) {
        emit({
          type: "ACTION_FAILED",
          phase: "MOVE",
          actorId: characterId,
          actionId: definition.id,
          message: `${character.name}의 이동 대상이 없어 행동이 실패했습니다.`,
        });
        return;
      }
      const validation = validatePveMove(
        positionsFromState(state),
        characterId,
        moveDefinition,
        destination,
      );
      if (!validation.valid) {
        emit({
          type: "ACTION_FAILED",
          phase: "MOVE",
          actorId: characterId,
          actionId: definition.id,
          message: `${character.name} 이동 실패: ${validation.reason}`,
        });
        return;
      }
      const from = { ...character.position };
      character.position = { ...destination };
      if (definition.id === "ARCHER_RETREAT_SHOT") {
        context.retreatSucceeded = true;
      }
      emit({
        type: "MOVED",
        phase: "MOVE",
        actorId: characterId,
        actionId: definition.id,
        from,
        to: { ...destination },
        message: `${character.name}가 (${destination.x}, ${destination.y})로 이동했습니다.`,
      });
    });
  }

  for (const entry of actionOrder.filter((item) =>
    item.phase === "SUPPORT" && item.segment === "PRIMARY"
  )) {
    runAction(entry, (definition) => {
      if (entry.actorId === "BOSS") return;
      const characterId = entry.actorId;
      const action = actionFor(characterId);
      if (definition.id === "ARCHER_MARK") {
        state.boss.marked = true;
        emit({
          type: "BOSS_MARKED",
          phase: "SUPPORT",
          actorId: characterId,
          actionId: definition.id,
          message: "보스에게 표식을 부여했습니다. 이번 턴 피해가 25% 증가합니다.",
        });
      } else if (definition.id === "PRIEST_HEAL" && action.target?.type === "ALLY") {
        const target = state.characters[action.target.characterId];
        if (!target.alive) {
          emit({
            type: "ACTION_FAILED",
            phase: "SUPPORT",
            actorId: characterId,
            actionId: definition.id,
            message: "치유 대상이 생존해 있지 않아 행동이 실패했습니다.",
          });
          return;
        }
        const amount = Math.min(definition.value ?? 5, target.maxHp - target.hp);
        target.hp += amount;
        emit({
          type: "HEALED",
          phase: "SUPPORT",
          actorId: characterId,
          targetCharacterId: target.id,
          actionId: definition.id,
          amount,
          message: `${target.name}의 HP를 ${amount} 회복했습니다.`,
        });
      } else if (definition.id === "PRIEST_MASS_HEAL") {
        for (const targetId of PVE_CHARACTER_ORDER) {
          const target = state.characters[targetId];
          if (!target.alive) continue;
          const amount = Math.min(definition.value ?? 2, target.maxHp - target.hp);
          target.hp += amount;
          emit({
            type: "HEALED",
            phase: "SUPPORT",
            actorId: characterId,
            targetCharacterId: target.id,
            actionId: definition.id,
            amount,
            message: `${target.name}의 HP를 ${amount} 회복했습니다.`,
          });
        }
      }
    });
  }

  const resolveAttack = (
    characterId: PveCharacterId,
    definition: PveActionDefinition,
  ): void => {
    const action = actionFor(characterId);
    const selectedCenter = action.target?.type === "TILE"
      ? action.target.position
      : undefined;
    const geometry = getPveAttackGeometry(
      state,
      characterId,
      definition.id,
      selectedCenter,
    );
    if (!geometry.hitEnemyIds.includes(state.boss.id)) {
      emit({
        type: "ATTACK_MISSED",
        phase: "ATTACK",
        actorId: characterId,
        actionId: definition.id,
        ...(selectedCenter ? { selectedCenter } : {}),
        effectArea: geometry.effectArea,
        hitEnemyIds: geometry.hitEnemyIds,
        message: `${state.characters[characterId].name}의 ${definition.name} 범위에 적이 없어 빗나갔습니다.`,
      });
      return;
    }
    const baseDamage = definition.value ?? 0;
    const amount = Math.round(baseDamage * (state.boss.marked ? 1.25 : 1));
    state.boss.hp = Math.max(0, state.boss.hp - amount);
    emit({
      type: "BOSS_DAMAGED",
      phase: "ATTACK",
      actorId: characterId,
      actionId: definition.id,
      targetEnemyId: state.boss.id,
      damageType: definition.damageType,
      amount,
      rawAmount: baseDamage,
      ...(selectedCenter ? { selectedCenter } : {}),
      effectArea: geometry.effectArea,
      hitEnemyIds: geometry.hitEnemyIds,
      message: `${state.characters[characterId].name}가 보스에게 ${amount} 피해를 주었습니다.`,
    });
    if (state.boss.hp === 0) {
      state.result = "VICTORY";
      emit({
        type: "BOSS_DEFEATED",
        phase: "STATUS",
        actorId: "SYSTEM",
        message: "훈련용 골렘을 쓰러뜨렸습니다.",
      });
    }
  };

  for (const entry of actionOrder.filter((item) =>
    item.phase === "ATTACK" && item.actorType === "CHARACTER"
  )) {
    if (state.result !== "IN_PROGRESS") {
      skipAction(entry, "전투가 종료되어 행동이 취소되었습니다.");
      continue;
    }
    if (entry.segment === "RETREAT_ATTACK") {
      if (!state.characters.ARCHER.alive) {
        skipAction(entry, "궁수는 쓰러져 후퇴 사격을 이어갈 수 없습니다.");
        continue;
      }
      const definition = PVE_ACTIONS.ARCHER_RETREAT_SHOT;
      const geometry = getPveAttackGeometry(
        state,
        "ARCHER",
        definition.id,
      );
      activeTimelineEntryId = entry.id;
      try {
        emit({
          type: "ACTION_STARTED",
          phase: "ATTACK",
          actorId: "ARCHER",
          actionId: definition.id,
          actionName: entry.actionName,
          effectArea: geometry.effectArea,
          hitEnemyIds: geometry.hitEnemyIds,
          message: `궁수: ${entry.actionName}`,
        });
        if (context.retreatSucceeded) {
          resolveAttack("ARCHER", definition);
        } else {
          const reason = "후퇴 이동이 실패해 사격을 실행하지 못했습니다.";
          emit({
            type: "ACTION_FAILED",
            phase: "ATTACK",
            actorId: "ARCHER",
            actionId: definition.id,
            actionName: entry.actionName,
            skipReason: reason,
            message: reason,
          });
        }
      } finally {
        activeTimelineEntryId = null;
      }
      continue;
    }
    runAction(entry, (definition) => {
      if (entry.actorId !== "BOSS") resolveAttack(entry.actorId, definition);
    });
  }

  const damageCharacter = (targetId: PveCharacterId, rawDamage: number): void => {
    const target = state.characters[targetId];
    const reductionRate = Math.min(0.75, context.reductions.get(targetId) ?? 0);
    const reducedDamage = Math.round(rawDamage * (1 - reductionRate));
    const shieldAbsorbed = Math.min(target.shield, reducedDamage);
    const hpDamage = reducedDamage - shieldAbsorbed;
    target.shield -= shieldAbsorbed;
    target.hp = Math.max(0, target.hp - hpDamage);
    emit({
      type: "CHARACTER_DAMAGED",
      phase: "BOSS",
      actorId: "BOSS",
      targetCharacterId: targetId,
      damageType: "TRUE",
      amount: hpDamage,
      rawAmount: rawDamage,
      reductionRate,
      shieldAbsorbed,
      message: `${target.name}가 HP ${hpDamage} 피해를 받았습니다${shieldAbsorbed > 0 ? ` · 보호막 ${shieldAbsorbed} 흡수` : ""}.`,
    });
  };

  const bossEntry = actionOrder.find((entry) => entry.actorType === "BOSS")!;
  if (state.result === "IN_PROGRESS") {
    const intent = bossPlan[beat - 1]!;
    activeTimelineEntryId = bossEntry.id;
    try {
      emit({
        type: "BOSS_ACTION_STARTED",
        phase: "BOSS",
        actorId: "BOSS",
        actionName: bossEntry.actionName,
        message: `보스: ${intent.name}`,
      });
      if (intent.id === "COLUMN_SMASH") {
        for (const targetId of PVE_CHARACTER_ORDER) {
          const target = state.characters[targetId];
          if (target.alive && target.position.x === 4) {
            damageCharacter(targetId, intent.damage);
          }
        }
      } else if (intent.id === "UPPER_COLLAPSE" || intent.id === "CENTER_CRUSH") {
        const targetedRows = intent.id === "UPPER_COLLAPSE" ? [0, 1] : [1, 2];
        for (const targetId of PVE_CHARACTER_ORDER) {
          const target = state.characters[targetId];
          if (target.alive && targetedRows.includes(target.position.y)) {
            damageCharacter(targetId, intent.damage);
          }
        }
      } else if (
        intent.id === "TRACKING_BOLT"
        || intent.id === "MELEE_SMASH"
        || intent.id === "WEAKNESS_TRACKING"
      ) {
        const targetId = context.taunting && state.characters.WARRIOR.alive
          ? "WARRIOR"
          : intent.targetCharacterIds?.[0] ?? context.trackingTargetId;
        const target = state.characters[targetId];
        if (target.alive) {
          damageCharacter(targetId, intent.damage);
        } else {
          const reason = "추적 마력탄의 예고 대상이 이미 사망해 공격이 취소되었습니다.";
          emit({
            type: "ACTION_FAILED",
            phase: "BOSS",
            actorId: "BOSS",
            actionName: bossEntry.actionName,
            skipReason: reason,
            message: reason,
          });
        }
      } else if (intent.id === "FRACTURE_EXPLOSION") {
        for (const targetId of PVE_CHARACTER_ORDER) {
          const target = state.characters[targetId];
          if (target.alive && intent.targetTiles?.some((tile) =>
            tile.x === target.position.x && tile.y === target.position.y
          )) {
            damageCharacter(targetId, intent.damage);
          }
        }
      } else {
        for (const targetId of PVE_CHARACTER_ORDER) {
          if (state.characters[targetId].alive) {
            damageCharacter(targetId, intent.damage);
          }
        }
      }

      for (const targetId of PVE_CHARACTER_ORDER) {
        const target = state.characters[targetId];
        if (target.alive && target.hp <= 0) {
          target.alive = false;
          emit({
            type: "CHARACTER_DIED",
            phase: "STATUS",
            actorId: "SYSTEM",
            targetCharacterId: targetId,
            message: `${target.name}가 쓰러졌습니다.`,
          });
        }
      }
      if (PVE_CHARACTER_ORDER.every((id) => !state.characters[id].alive)) {
        state.result = "DEFEAT";
        emit({
          type: "PARTY_DEFEATED",
          phase: "STATUS",
          actorId: "SYSTEM",
          message: "파티가 전멸했습니다.",
        });
      }
    } finally {
      activeTimelineEntryId = null;
    }
  } else {
    skipAction(bossEntry, "보스가 쓰러져 이번 보스 행동은 취소되었습니다.");
  }

  emit({
    type: "BEAT_FINISHED",
    phase: "STATUS",
    actorId: "SYSTEM",
    message: `${beat} 비트 종료`,
  });
  return { state, events, actionOrder };
}

export function resolvePveBeat(
  state: PveBattleState,
  plans: PvePlans,
  beat: PveBeat,
  trackingTargetId = selectPveTrackingTarget(state),
  bossPlan: PveBossPlan = PVE_BOSS_INTENTS,
): { state: PveBattleState; events: PveCombatEvent[] } {
  if (!isPvePlanComplete(plans)) {
    throw new Error("PVE_PLAN_INCOMPLETE");
  }
  const result = resolveBeatInternal(state, plans, beat, trackingTargetId, 0, bossPlan);
  return { state: result.state, events: result.events };
}

export function resolvePveTurn(
  input: PveBattleState,
  plans: PvePlans,
  bossPlan: PveBossPlan = PVE_BOSS_INTENTS,
): PveTurnResolution {
  if (!isPvePlanComplete(plans)) {
    throw new Error("PVE_PLAN_INCOMPLETE");
  }
  let state = clonePveBattleState(input);
  state.boss.marked = false;
  state.result = "IN_PROGRESS";
  const trackingTargetId = selectPveTrackingTarget(state);
  const events: PveCombatEvent[] = [];
  const actionOrder: PveActionOrderEntry[] = [];
  for (const beat of [1, 2, 3] as const) {
    const result = resolveBeatInternal(
      state,
      plans,
      beat,
      trackingTargetId,
      events.length,
      bossPlan,
    );
    state = result.state;
    events.push(...result.events);
    actionOrder.push(...result.actionOrder);
    if (state.result !== "IN_PROGRESS") break;
  }
  state.boss.marked = false;
  const lastBeat = events.at(-1)?.beat ?? 1;
  events.push({
    id: `turn-event-${events.length + 1}`,
    beat: lastBeat,
    phase: "STATUS",
    type: "TURN_FINISHED",
    actorId: "SYSTEM",
    message: state.result === "IN_PROGRESS"
      ? "3개 비트의 시뮬레이션이 완료되었습니다."
      : state.result === "VICTORY"
        ? "전투 승리"
        : "전투 패배",
    state: clonePveBattleState(state),
  });
  const timeline = buildPveResolvedActionTimeline(events, actionOrder);
  return { state, events, timeline, trackingTargetId };
}
