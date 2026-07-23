import { getPveAttackGeometry } from "./attack-range";
import {
  PVE_ACTIONS,
  PVE_BOARD_HEIGHT,
  PVE_BOARD_WIDTH,
  PVE_CHARACTER_ORDER,
} from "./fixtures";
import type {
  PveActionPreview,
  PveActionTarget,
  PveBattleState,
  PveBeat,
  PveCharacterId,
  PvePlannedAction,
  PvePlans,
  PvePosition,
} from "./types";
import {
  projectPveAttackPlanningPositions,
  projectPvePlanningPositions,
  validatePveMove,
  validatePvePlannedAction,
} from "./validation";

function samePosition(left: PvePosition, right: PvePosition): boolean {
  return left.x === right.x && left.y === right.y;
}

function clonePlansWithAction(
  plans: PvePlans,
  characterId: PveCharacterId,
  beat: PveBeat,
  action: PvePlannedAction,
): PvePlans {
  const cloned = {
    WARRIOR: plans.WARRIOR.map((entry) => entry ? structuredClone(entry) : null),
    ARCHER: plans.ARCHER.map((entry) => entry ? structuredClone(entry) : null),
    MAGE: plans.MAGE.map((entry) => entry ? structuredClone(entry) : null),
    PRIEST: plans.PRIEST.map((entry) => entry ? structuredClone(entry) : null),
  } as PvePlans;
  cloned[characterId][beat - 1] = structuredClone(action);
  return cloned;
}

function stateAtPositions(
  state: PveBattleState,
  positions: Record<PveCharacterId, PvePosition>,
): PveBattleState {
  return {
    characters: {
      WARRIOR: { ...state.characters.WARRIOR, position: { ...positions.WARRIOR } },
      ARCHER: { ...state.characters.ARCHER, position: { ...positions.ARCHER } },
      MAGE: { ...state.characters.MAGE, position: { ...positions.MAGE } },
      PRIEST: { ...state.characters.PRIEST, position: { ...positions.PRIEST } },
    },
    boss: {
      ...state.boss,
      occupiedTiles: state.boss.occupiedTiles.map((position) => ({ ...position })),
    },
    result: state.result,
  };
}

function boardTiles(): PvePosition[] {
  const result: PvePosition[] = [];
  for (let y = 0; y < PVE_BOARD_HEIGHT; y += 1) {
    for (let x = 0; x < PVE_BOARD_WIDTH; x += 1) result.push({ x, y });
  }
  return result;
}

function movementPath(
  origin: PvePosition,
  destination: PvePosition,
  teleport: boolean,
): PvePosition[] {
  if (teleport) return [{ ...destination }];
  const distance = Math.abs(destination.x - origin.x) + Math.abs(destination.y - origin.y);
  const stepX = Math.sign(destination.x - origin.x);
  const stepY = Math.sign(destination.y - origin.y);
  return Array.from({ length: distance }, (_, index) => ({
    x: origin.x + stepX * (index + 1),
    y: origin.y + stepY * (index + 1),
  }));
}

function emptyPreview(
  characterId: PveCharacterId,
  beat: PveBeat,
  action: PvePlannedAction,
  originPosition: PvePosition,
): PveActionPreview {
  const definition = PVE_ACTIONS[action.actionId];
  return {
    actionId: action.actionId,
    actorId: characterId,
    beat,
    originPosition: { ...originPosition },
    selectableTiles: [],
    pathTiles: [],
    effectTiles: [],
    selectedTile: action.target?.type === "TILE" ? { ...action.target.position } : null,
    selectableCharacterIds: [],
    selectedCharacterId: action.target?.type === "ALLY" ? action.target.characterId : null,
    predictedTargetIds: [],
    willHitBoss: false,
    requiresTileTarget: definition.targetType === "TILE",
    requiresCharacterTarget: definition.targetType === "ALLY",
    invalidReason: null,
  };
}

export function getPveActionPreview(
  state: PveBattleState,
  plans: PvePlans,
  characterId: PveCharacterId,
  beat: PveBeat,
  actionId: PvePlannedAction["actionId"],
  target?: PveActionTarget,
): PveActionPreview {
  const definition = PVE_ACTIONS[actionId];
  const action: PvePlannedAction = target ? { actionId, target } : { actionId };
  const positionsBeforeAction = projectPvePlanningPositions(state, plans, beat);
  const preview = emptyPreview(
    characterId,
    beat,
    action,
    positionsBeforeAction[characterId],
  );

  if (definition.owner !== "COMMON" && definition.owner !== characterId) {
    preview.invalidReason = "이 캐릭터가 사용할 수 없는 행동입니다.";
    return preview;
  }
  if (!state.characters[characterId].alive) {
    preview.invalidReason = "사망한 캐릭터는 행동할 수 없습니다.";
    return preview;
  }

  if (definition.targetType === "ALLY") {
    preview.selectableCharacterIds = PVE_CHARACTER_ORDER.filter((id) => state.characters[id].alive);
    if (target?.type === "ALLY") {
      const validation = validatePvePlannedAction(state, plans, characterId, beat, action);
      if (validation.valid) preview.predictedTargetIds = [target.characterId];
      else preview.invalidReason = validation.reason;
    }
    return preview;
  }

  if (definition.phase === "MOVE" && !definition.attackPattern) {
    preview.selectableTiles = boardTiles().filter((destination) =>
      validatePveMove(positionsBeforeAction, characterId, definition, destination).valid
    );
    if (target?.type === "TILE") {
      const validation = validatePveMove(
        positionsBeforeAction,
        characterId,
        definition,
        target.position,
      );
      if (validation.valid) {
        preview.pathTiles = movementPath(
          positionsBeforeAction[characterId],
          target.position,
          definition.id === "MAGE_TELEPORT",
        );
      } else preview.invalidReason = validation.reason;
    }
    return preview;
  }

  const candidatePlans = clonePlansWithAction(plans, characterId, beat, action);
  const attackPositions = projectPveAttackPlanningPositions(state, candidatePlans, beat);
  const attackState = stateAtPositions(state, attackPositions);
  preview.originPosition = { ...attackPositions[characterId] };

  if (definition.id === "ARCHER_RETREAT_SHOT") {
    const retreatDestination = {
      x: positionsBeforeAction.ARCHER.x - 1,
      y: positionsBeforeAction.ARCHER.y,
    };
    const validation = validatePveMove(
      positionsBeforeAction,
      "ARCHER",
      PVE_ACTIONS.ARCHER_MOVE,
      retreatDestination,
    );
    if (validation.valid) preview.pathTiles = [{ ...retreatDestination }];
    else preview.invalidReason = validation.reason;
  }

  if (definition.attackPattern) {
    const center = target?.type === "TILE" ? target.position : undefined;
    const geometry = getPveAttackGeometry(
      attackState,
      characterId,
      actionId,
      center,
    );
    preview.selectableTiles = definition.targetType === "TILE"
      ? geometry.useRange.map((position) => ({ ...position }))
      : [];
    preview.effectTiles = geometry.effectArea.map((position) => ({ ...position }));
    preview.predictedTargetIds = [...geometry.hitEnemyIds];
    preview.willHitBoss = geometry.hitEnemyIds.includes(state.boss.id);
    if (target?.type === "TILE") {
      const validation = validatePvePlannedAction(state, plans, characterId, beat, action);
      if (!validation.valid) preview.invalidReason = validation.reason;
    }
  }

  return preview;
}

export function isPvePreviewPosition(
  positions: readonly PvePosition[],
  position: PvePosition,
): boolean {
  return positions.some((candidate) => samePosition(candidate, position));
}
