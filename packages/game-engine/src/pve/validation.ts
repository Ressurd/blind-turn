import {
  PVE_ACTIONS,
  PVE_BOARD_HEIGHT,
  PVE_BOARD_WIDTH,
  PVE_CHARACTER_ORDER,
} from "./fixtures";
import { getPveAttackUseRange } from "./attack-range";
import type {
  PveActionDefinition,
  PveBattleState,
  PveBeat,
  PveCharacterId,
  PvePlannedAction,
  PvePlans,
  PvePosition,
  PveValidationResult,
} from "./types";

export function isPvePositionInBounds(position: PvePosition): boolean {
  return position.x >= 0
    && position.x < PVE_BOARD_WIDTH
    && position.y >= 0
    && position.y < PVE_BOARD_HEIGHT;
}

export function pveManhattanDistance(
  from: PvePosition,
  to: PvePosition,
): number {
  return Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
}

function samePosition(left: PvePosition, right: PvePosition): boolean {
  return left.x === right.x && left.y === right.y;
}

function occupiedBy(
  positions: Record<PveCharacterId, PvePosition>,
  destination: PvePosition,
  movingId: PveCharacterId,
): PveCharacterId | null {
  return PVE_CHARACTER_ORDER.find((id) =>
    id !== movingId && samePosition(positions[id], destination)
  ) ?? null;
}

function pathIsClear(
  positions: Record<PveCharacterId, PvePosition>,
  movingId: PveCharacterId,
  from: PvePosition,
  to: PvePosition,
): boolean {
  const distance = pveManhattanDistance(from, to);
  if (distance <= 1) return true;
  const step = {
    x: Math.sign(to.x - from.x),
    y: Math.sign(to.y - from.y),
  };
  for (let index = 1; index < distance; index += 1) {
    const position = {
      x: from.x + step.x * index,
      y: from.y + step.y * index,
    };
    if (occupiedBy(positions, position, movingId)) return false;
  }
  return true;
}

export function validatePveMove(
  positions: Record<PveCharacterId, PvePosition>,
  characterId: PveCharacterId,
  definition: PveActionDefinition,
  destination: PvePosition,
): PveValidationResult {
  const from = positions[characterId];
  if (!isPvePositionInBounds(destination)) {
    return { valid: false, reason: "전장 밖으로 이동할 수 없습니다." };
  }
  if (samePosition(from, destination)) {
    return { valid: false, reason: "현재 타일을 이동 대상으로 선택할 수 없습니다." };
  }
  if (occupiedBy(positions, destination, characterId)) {
    return { valid: false, reason: "이미 다른 캐릭터가 점유한 타일입니다." };
  }
  const distance = pveManhattanDistance(from, destination);
  if (definition.id === "MAGE_TELEPORT") {
    return distance <= (definition.maxDistance ?? 2)
      ? { valid: true }
      : { valid: false, reason: "순간이동은 맨해튼 거리 2 이내만 가능합니다." };
  }
  const isStraight = from.x === destination.x || from.y === destination.y;
  if (!isStraight || distance > (definition.maxDistance ?? 1)) {
    return {
      valid: false,
      reason: definition.id === "ARCHER_MOVE"
        ? "궁수는 상하좌우 방향으로 최대 2칸 이동할 수 있습니다."
        : "상하좌우 인접 타일로만 이동할 수 있습니다.",
    };
  }
  if (!pathIsClear(positions, characterId, from, destination)) {
    return { valid: false, reason: "다른 캐릭터를 통과할 수 없습니다." };
  }
  return { valid: true };
}

function cloneInitialPositions(
  state: PveBattleState,
): Record<PveCharacterId, PvePosition> {
  return {
    WARRIOR: { ...state.characters.WARRIOR.position },
    ARCHER: { ...state.characters.ARCHER.position },
    MAGE: { ...state.characters.MAGE.position },
    PRIEST: { ...state.characters.PRIEST.position },
  };
}

export function projectPvePlanningPositions(
  state: PveBattleState,
  plans: PvePlans,
  beforeBeat: PveBeat,
): Record<PveCharacterId, PvePosition> {
  const positions = cloneInitialPositions(state);
  for (let beat = 1; beat < beforeBeat; beat += 1) {
    applyPvePlanningMovements(positions, plans, beat as PveBeat);
  }
  return positions;
}

function applyPvePlanningMovements(
  positions: Record<PveCharacterId, PvePosition>,
  plans: PvePlans,
  beat: PveBeat,
): void {
  for (const characterId of PVE_CHARACTER_ORDER) {
    const action = plans[characterId][beat - 1];
    if (!action) continue;
    const definition = PVE_ACTIONS[action.actionId];
    if (
      definition.phase === "MOVE"
      && definition.targetType === "TILE"
      && action.target?.type === "TILE"
    ) {
      const result = validatePveMove(
        positions,
        characterId,
        definition,
        action.target.position,
      );
      if (result.valid) positions[characterId] = { ...action.target.position };
    } else if (definition.id === "ARCHER_RETREAT_SHOT") {
      const destination = {
        x: positions.ARCHER.x - 1,
        y: positions.ARCHER.y,
      };
      const result = validatePveMove(
        positions,
        "ARCHER",
        PVE_ACTIONS.ARCHER_MOVE,
        destination,
      );
      if (result.valid) positions.ARCHER = destination;
    }
  }
}

export function projectPveAttackPlanningPositions(
  state: PveBattleState,
  plans: PvePlans,
  beat: PveBeat,
): Record<PveCharacterId, PvePosition> {
  const positions = projectPvePlanningPositions(state, plans, beat);
  applyPvePlanningMovements(positions, plans, beat);
  return positions;
}

export function validatePvePlannedAction(
  state: PveBattleState,
  plans: PvePlans,
  characterId: PveCharacterId,
  beat: PveBeat,
  action: PvePlannedAction,
): PveValidationResult {
  const definition = PVE_ACTIONS[action.actionId];
  if (definition.owner !== "COMMON" && definition.owner !== characterId) {
    return { valid: false, reason: "이 캐릭터가 사용할 수 없는 행동입니다." };
  }
  if (definition.targetType === "NONE") {
    return action.target
      ? { valid: false, reason: "대상이 필요하지 않은 행동입니다." }
      : { valid: true };
  }
  if (definition.targetType === "ALLY") {
    if (action.target?.type !== "ALLY") {
      return { valid: false, reason: "아군 대상을 선택하세요." };
    }
    return state.characters[action.target.characterId].alive
      ? { valid: true }
      : { valid: false, reason: "사망한 아군은 대상으로 선택할 수 없습니다." };
  }
  if (action.target?.type !== "TILE") {
    return { valid: false, reason: "이동할 타일을 선택하세요." };
  }
  const targetPosition = action.target.position;
  const positions = projectPvePlanningPositions(state, plans, beat);
  if (definition.phase === "ATTACK") {
    const useRange = getPveAttackUseRange(
      positions[characterId],
      definition.id,
    );
    return useRange.some((position) => samePosition(position, targetPosition))
      ? { valid: true }
      : {
        valid: false,
        reason: "공격 중심 타일은 실행 위치에서 맨해튼 거리 3 이내여야 합니다.",
      };
  }
  return validatePveMove(
    positions,
    characterId,
    definition,
    targetPosition,
  );
}
