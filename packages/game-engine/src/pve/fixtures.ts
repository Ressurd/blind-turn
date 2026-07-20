import type {
  PveActionDefinition,
  PveActionId,
  PveBattleState,
  PveBossIntent,
  PveCharacterId,
  PvePlans,
} from "./types";

export const PVE_BOARD_WIDTH = 6;
export const PVE_BOARD_HEIGHT = 4;

export const PVE_CHARACTER_ORDER: readonly PveCharacterId[] = [
  "WARRIOR",
  "ARCHER",
  "MAGE",
  "PRIEST",
];

export const PVE_BOSS_INTENTS: readonly PveBossIntent[] = [
  {
    beat: 1,
    id: "COLUMN_SMASH",
    name: "열 내려치기",
    description: "x=4 열의 모든 캐릭터에게 고정 피해 5 · 도발 불가",
    damage: 5,
    tauntable: false,
  },
  {
    beat: 2,
    id: "TRACKING_BOLT",
    name: "추적 마력탄",
    description: "예고 대상에게 고정 피해 6 · 도발 가능",
    damage: 6,
    tauntable: true,
  },
  {
    beat: 3,
    id: "EARTH_QUAKE",
    name: "대지 진동",
    description: "생존한 모든 아군에게 고정 피해 4 · 도발 불가",
    damage: 4,
    tauntable: false,
  },
];

export const PVE_ACTIONS: Record<PveActionId, PveActionDefinition> = {
  PASS: {
    id: "PASS",
    owner: "COMMON",
    name: "PASS",
    description: "아무 행동도 하지 않습니다.",
    targetType: "NONE",
    phase: "PREPARE",
  },
  WARRIOR_MOVE: {
    id: "WARRIOR_MOVE",
    owner: "WARRIOR",
    name: "이동",
    description: "상하좌우 인접한 빈 타일로 1칸 이동합니다.",
    targetType: "TILE",
    phase: "MOVE",
    maxDistance: 1,
  },
  WARRIOR_SLASH: {
    id: "WARRIOR_SLASH",
    owner: "WARRIOR",
    name: "베기",
    description: "보스에게 물리 고정 피해 5를 줍니다.",
    targetType: "NONE",
    phase: "ATTACK",
    value: 5,
    damageType: "PHYSICAL",
  },
  WARRIOR_TAUNT: {
    id: "WARRIOR_TAUNT",
    owner: "WARRIOR",
    name: "도발",
    description: "이번 비트의 도발 가능한 보스 공격을 전사에게 돌립니다.",
    targetType: "NONE",
    phase: "PREPARE",
  },
  WARRIOR_DEFEND: {
    id: "WARRIOR_DEFEND",
    owner: "WARRIOR",
    name: "방어",
    description: "이번 비트에 전사가 받는 최종 피해를 50% 줄입니다.",
    targetType: "NONE",
    phase: "PREPARE",
  },
  ARCHER_MOVE: {
    id: "ARCHER_MOVE",
    owner: "ARCHER",
    name: "이동",
    description: "상하좌우 방향으로 최대 2칸 이동하며 캐릭터를 통과할 수 없습니다.",
    targetType: "TILE",
    phase: "MOVE",
    maxDistance: 2,
  },
  ARCHER_SHOT: {
    id: "ARCHER_SHOT",
    owner: "ARCHER",
    name: "사격",
    description: "보스에게 물리 고정 피해 4를 줍니다.",
    targetType: "NONE",
    phase: "ATTACK",
    value: 4,
    damageType: "PHYSICAL",
  },
  ARCHER_RETREAT_SHOT: {
    id: "ARCHER_RETREAT_SHOT",
    owner: "ARCHER",
    name: "후퇴 사격",
    description: "왼쪽 빈 타일로 1칸 이동한 뒤 물리 고정 피해 3을 줍니다.",
    targetType: "NONE",
    phase: "MOVE",
    value: 3,
    damageType: "PHYSICAL",
  },
  ARCHER_MARK: {
    id: "ARCHER_MARK",
    owner: "ARCHER",
    name: "표식",
    description: "이후 이번 턴 동안 보스가 받는 피해를 25% 늘립니다.",
    targetType: "NONE",
    phase: "SUPPORT",
  },
  MAGE_MOVE: {
    id: "MAGE_MOVE",
    owner: "MAGE",
    name: "이동",
    description: "상하좌우 인접한 빈 타일로 1칸 이동합니다.",
    targetType: "TILE",
    phase: "MOVE",
    maxDistance: 1,
  },
  MAGE_FIREBALL: {
    id: "MAGE_FIREBALL",
    owner: "MAGE",
    name: "화염구",
    description: "보스에게 마법 고정 피해 6을 줍니다.",
    targetType: "NONE",
    phase: "ATTACK",
    value: 6,
    damageType: "MAGIC",
  },
  MAGE_TELEPORT: {
    id: "MAGE_TELEPORT",
    owner: "MAGE",
    name: "순간이동",
    description: "맨해튼 거리 2 이내의 빈 타일로 이동하며 캐릭터를 통과합니다.",
    targetType: "TILE",
    phase: "MOVE",
    maxDistance: 2,
  },
  MAGE_SHIELD: {
    id: "MAGE_SHIELD",
    owner: "MAGE",
    name: "보호막",
    description: "아군 한 명에게 피해를 먼저 흡수하는 보호막 5를 부여합니다.",
    targetType: "ALLY",
    phase: "PREPARE",
    value: 5,
  },
  PRIEST_MOVE: {
    id: "PRIEST_MOVE",
    owner: "PRIEST",
    name: "이동",
    description: "상하좌우 인접한 빈 타일로 1칸 이동합니다.",
    targetType: "TILE",
    phase: "MOVE",
    maxDistance: 1,
  },
  PRIEST_HEAL: {
    id: "PRIEST_HEAL",
    owner: "PRIEST",
    name: "치유",
    description: "아군 한 명의 HP를 최대 5 회복합니다.",
    targetType: "ALLY",
    phase: "SUPPORT",
    value: 5,
  },
  PRIEST_GUARD: {
    id: "PRIEST_GUARD",
    owner: "PRIEST",
    name: "수호",
    description: "아군 한 명이 이번 비트에 받는 최종 피해를 50% 줄입니다.",
    targetType: "ALLY",
    phase: "PREPARE",
  },
  PRIEST_MASS_HEAL: {
    id: "PRIEST_MASS_HEAL",
    owner: "PRIEST",
    name: "광역 치유",
    description: "생존한 모든 아군의 HP를 최대 2 회복합니다.",
    targetType: "NONE",
    phase: "SUPPORT",
    value: 2,
  },
};

const ACTION_IDS_BY_CHARACTER: Record<PveCharacterId, readonly PveActionId[]> = {
  WARRIOR: ["PASS", "WARRIOR_MOVE", "WARRIOR_SLASH", "WARRIOR_TAUNT", "WARRIOR_DEFEND"],
  ARCHER: ["PASS", "ARCHER_MOVE", "ARCHER_SHOT", "ARCHER_RETREAT_SHOT", "ARCHER_MARK"],
  MAGE: ["PASS", "MAGE_MOVE", "MAGE_FIREBALL", "MAGE_TELEPORT", "MAGE_SHIELD"],
  PRIEST: ["PASS", "PRIEST_MOVE", "PRIEST_HEAL", "PRIEST_GUARD", "PRIEST_MASS_HEAL"],
};

export function getPveActionsForCharacter(
  characterId: PveCharacterId,
): PveActionDefinition[] {
  return ACTION_IDS_BY_CHARACTER[characterId].map((id) => PVE_ACTIONS[id]);
}

export function createInitialPveBattleState(): PveBattleState {
  return {
    characters: {
      WARRIOR: {
        id: "WARRIOR",
        name: "전사",
        token: "전",
        hp: 30,
        maxHp: 30,
        shield: 0,
        alive: true,
        position: { x: 4, y: 1 },
      },
      ARCHER: {
        id: "ARCHER",
        name: "궁수",
        token: "궁",
        hp: 20,
        maxHp: 20,
        shield: 0,
        alive: true,
        position: { x: 0, y: 0 },
      },
      MAGE: {
        id: "MAGE",
        name: "마법사",
        token: "마",
        hp: 18,
        maxHp: 18,
        shield: 0,
        alive: true,
        position: { x: 1, y: 2 },
      },
      PRIEST: {
        id: "PRIEST",
        name: "사제",
        token: "사",
        hp: 22,
        maxHp: 22,
        shield: 0,
        alive: true,
        position: { x: 0, y: 3 },
      },
    },
    boss: {
      id: "TRAINING_GOLEM",
      name: "훈련용 골렘",
      hp: 80,
      maxHp: 80,
      marked: false,
    },
    result: "IN_PROGRESS",
  };
}

export function createEmptyPvePlans(): PvePlans {
  return {
    WARRIOR: [null, null, null],
    ARCHER: [null, null, null],
    MAGE: [null, null, null],
    PRIEST: [null, null, null],
  };
}

export function createPassPvePlans(): PvePlans {
  return {
    WARRIOR: [{ actionId: "PASS" }, { actionId: "PASS" }, { actionId: "PASS" }],
    ARCHER: [{ actionId: "PASS" }, { actionId: "PASS" }, { actionId: "PASS" }],
    MAGE: [{ actionId: "PASS" }, { actionId: "PASS" }, { actionId: "PASS" }],
    PRIEST: [{ actionId: "PASS" }, { actionId: "PASS" }, { actionId: "PASS" }],
  };
}

export function selectPveTrackingTarget(state: PveBattleState): PveCharacterId {
  const target = PVE_CHARACTER_ORDER
    .map((id) => state.characters[id])
    .filter((character) => character.alive)
    .sort((left, right) => left.position.x - right.position.x)[0];
  if (!target) throw new Error("No living character can be tracked");
  return target.id;
}

export function isPvePlanComplete(plans: PvePlans): boolean {
  return PVE_CHARACTER_ORDER.every((id) => plans[id].every(Boolean));
}
