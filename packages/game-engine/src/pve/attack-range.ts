import { PVE_ACTIONS, PVE_BOARD_HEIGHT, PVE_BOARD_WIDTH, PVE_CHARACTER_ORDER } from "./fixtures";
import type {
  PveActionId,
  PveAttackGeometry,
  PveBattleState,
  PveCharacterId,
  PveEnemyId,
  PveEnemyOccupancy,
  PvePosition,
} from "./types";

const PVE_COMBAT_MAX_X = PVE_BOARD_WIDTH;

function samePosition(left: PvePosition, right: PvePosition): boolean {
  return left.x === right.x && left.y === right.y;
}

function uniquePositions(positions: PvePosition[]): PvePosition[] {
  return positions.filter((position, index) =>
    positions.findIndex((candidate) => samePosition(candidate, position)) === index
  );
}

export function isPveCombatPositionInBounds(position: PvePosition): boolean {
  const insideBoard = position.x >= 0
    && position.x < PVE_BOARD_WIDTH
    && position.y >= 0
    && position.y < PVE_BOARD_HEIGHT;
  const insideBossArea = position.x === PVE_COMBAT_MAX_X
    && (position.y === 1 || position.y === 2);
  return insideBoard || insideBossArea;
}

export function getPveEnemyOccupancies(
  state: PveBattleState,
): PveEnemyOccupancy[] {
  if (state.boss.hp <= 0) return [];
  return [{
    enemyId: state.boss.id,
    occupiedTiles: state.boss.occupiedTiles.map((position) => ({ ...position })),
  }];
}

export function getPveAttackUseRange(
  origin: PvePosition,
  actionId: PveActionId,
): PvePosition[] {
  const definition = PVE_ACTIONS[actionId];
  const result: PvePosition[] = [];

  if (definition.targetType === "TILE" && definition.phase === "ATTACK") {
    for (let y = 0; y < PVE_BOARD_HEIGHT; y += 1) {
      for (let x = 0; x <= PVE_COMBAT_MAX_X; x += 1) {
        if (!isPveCombatPositionInBounds({ x, y })) continue;
        const distance = Math.abs(origin.x - x) + Math.abs(origin.y - y);
        if (distance <= (definition.maxDistance ?? 0)) result.push({ x, y });
      }
    }
    return result;
  }

  switch (definition.attackPattern) {
    case "RIGHT_ONE":
      result.push({ x: origin.x + 1, y: origin.y });
      break;
    case "RIGHT_SWEEP":
      result.push(
        { x: origin.x + 1, y: origin.y - 1 },
        { x: origin.x + 1, y: origin.y },
        { x: origin.x + 1, y: origin.y + 1 },
      );
      break;
    case "RIGHT_LINE_FOUR_BLOCKED":
      for (let offset = 1; offset <= 4; offset += 1) {
        result.push({ x: origin.x + offset, y: origin.y });
      }
      break;
    case "RIGHT_ROW_ALL":
      for (let x = origin.x + 1; x <= PVE_COMBAT_MAX_X; x += 1) {
        result.push({ x, y: origin.y });
      }
      break;
    case "RIGHT_LINE_TWO":
      for (let offset = 1; offset <= 2; offset += 1) {
        result.push({ x: origin.x + offset, y: origin.y });
      }
      break;
  }
  return uniquePositions(result.filter(isPveCombatPositionInBounds));
}

function getBlockingUnitPositions(
  state: PveBattleState,
  actorId: PveCharacterId,
): PvePosition[] {
  const characters = PVE_CHARACTER_ORDER
    .filter((characterId) => characterId !== actorId && state.characters[characterId].alive)
    .map((characterId) => state.characters[characterId].position);
  const enemies = getPveEnemyOccupancies(state).flatMap((enemy) => enemy.occupiedTiles);
  return [...characters, ...enemies];
}

function getBlockedRightLine(
  state: PveBattleState,
  actorId: PveCharacterId,
  origin: PvePosition,
  length: number,
): PvePosition[] {
  const blockers = getBlockingUnitPositions(state, actorId);
  const result: PvePosition[] = [];
  for (let offset = 1; offset <= length; offset += 1) {
    const position = { x: origin.x + offset, y: origin.y };
    if (!isPveCombatPositionInBounds(position)) break;
    result.push(position);
    if (blockers.some((blocker) => samePosition(blocker, position))) break;
  }
  return result;
}

export function getPveAttackEffectArea(
  state: PveBattleState,
  actorId: PveCharacterId,
  actionId: PveActionId,
  selectedCenter?: PvePosition,
): PvePosition[] {
  const definition = PVE_ACTIONS[actionId];
  const origin = state.characters[actorId].position;
  const pattern = definition.attackPattern;
  let positions: PvePosition[] = [];

  if (definition.targetType === "TILE" && definition.phase === "ATTACK") {
    const useRange = getPveAttackUseRange(origin, actionId);
    if (!selectedCenter || !useRange.some((position) => samePosition(position, selectedCenter))) {
      return [];
    }
  }

  switch (pattern) {
    case "RIGHT_ONE":
      positions = [{ x: origin.x + 1, y: origin.y }];
      break;
    case "RIGHT_SWEEP":
      positions = [-1, 0, 1].map((offsetY) => ({
        x: origin.x + 1,
        y: origin.y + offsetY,
      }));
      break;
    case "RIGHT_LINE_FOUR_BLOCKED":
      return getBlockedRightLine(state, actorId, origin, 4);
    case "VERTICAL_THREE":
      if (selectedCenter) {
        positions = [-1, 0, 1].map((offsetY) => ({
          x: selectedCenter.x,
          y: selectedCenter.y + offsetY,
        }));
      }
      break;
    case "CROSS_FIVE":
      if (selectedCenter) {
        positions = [
          selectedCenter,
          { x: selectedCenter.x - 1, y: selectedCenter.y },
          { x: selectedCenter.x + 1, y: selectedCenter.y },
          { x: selectedCenter.x, y: selectedCenter.y - 1 },
          { x: selectedCenter.x, y: selectedCenter.y + 1 },
        ];
      }
      break;
    case "RIGHT_ROW_ALL":
      for (let x = origin.x + 1; x <= PVE_COMBAT_MAX_X; x += 1) {
        positions.push({ x, y: origin.y });
      }
      break;
    case "RIGHT_LINE_TWO":
      for (let offset = 1; offset <= 2; offset += 1) {
        positions.push({ x: origin.x + offset, y: origin.y });
      }
      break;
  }

  return uniquePositions(positions.filter(isPveCombatPositionInBounds));
}

export function getPveHitEnemyIds(
  effectArea: readonly PvePosition[],
  enemies: readonly PveEnemyOccupancy[],
): PveEnemyId[] {
  return enemies
    .filter((enemy) => enemy.occupiedTiles.some((occupiedTile) =>
      effectArea.some((effectTile) => samePosition(effectTile, occupiedTile))
    ))
    .map((enemy) => enemy.enemyId);
}

export function getPveAttackGeometry(
  state: PveBattleState,
  actorId: PveCharacterId,
  actionId: PveActionId,
  selectedCenter?: PvePosition,
): PveAttackGeometry {
  const origin = { ...state.characters[actorId].position };
  const useRange = getPveAttackUseRange(origin, actionId);
  const effectArea = getPveAttackEffectArea(
    state,
    actorId,
    actionId,
    selectedCenter,
  );
  const enemyOccupancies = getPveEnemyOccupancies(state);
  return {
    actionId,
    origin,
    useRange,
    selectedCenter: selectedCenter ? { ...selectedCenter } : null,
    effectArea,
    enemyOccupancies,
    hitEnemyIds: getPveHitEnemyIds(effectArea, enemyOccupancies),
  };
}
