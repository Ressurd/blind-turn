import type {
  PveActionDefinition,
  PveActionId,
  PveBattleState,
  PveBossPlan,
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

export const PVE_BOSS_INTENTS: PveBossPlan = [
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

function livingCharacters(state: PveBattleState) {
  return PVE_CHARACTER_ORDER
    .map((id) => state.characters[id])
    .filter((character) => character.alive);
}

function farthestFromBoss(state: PveBattleState): PveCharacterId {
  return livingCharacters(state)
    .sort((left, right) => left.position.x - right.position.x)[0]!.id;
}

function nearestToBoss(state: PveBattleState): PveCharacterId {
  return livingCharacters(state)
    .sort((left, right) => right.position.x - left.position.x)[0]!.id;
}

function lowestHpRatio(state: PveBattleState): PveCharacterId {
  return livingCharacters(state)
    .sort((left, right) => left.hp / left.maxHp - right.hp / right.maxHp)[0]!.id;
}

export function createPveBossPlan(
  turnNumber: number,
  state: PveBattleState,
): PveBossPlan {
  if (!Number.isInteger(turnNumber) || turnNumber < 1) {
    throw new Error("PVE_TURN_NUMBER_INVALID");
  }
  const pattern = (turnNumber - 1) % 3;
  if (pattern === 0) {
    const target = farthestFromBoss(state);
    return [
      { ...PVE_BOSS_INTENTS[0] },
      { ...PVE_BOSS_INTENTS[1], targetCharacterIds: [target] },
      { ...PVE_BOSS_INTENTS[2] },
    ];
  }
  if (pattern === 1) {
    const nearest = nearestToBoss(state);
    const fractureTargets = livingCharacters(state).slice(0, 2);
    return [
      {
        beat: 1,
        id: "UPPER_COLLAPSE",
        name: "상단 붕괴",
        description: "y=0, y=1의 모든 캐릭터에게 고정 피해 5 · 도발 불가",
        damage: 5,
        tauntable: false,
      },
      {
        beat: 2,
        id: "MELEE_SMASH",
        name: "근접 강타",
        description: "가장 가까운 예고 대상에게 고정 피해 7 · 도발 가능",
        damage: 7,
        tauntable: true,
        targetCharacterIds: [nearest],
      },
      {
        beat: 3,
        id: "FRACTURE_EXPLOSION",
        name: "균열 폭발",
        description: "예고된 두 타일에 남은 캐릭터에게 고정 피해 6 · 도발 불가",
        damage: 6,
        tauntable: false,
        targetCharacterIds: fractureTargets.map((character) => character.id),
        targetTiles: fractureTargets.map((character) => ({ ...character.position })),
      },
    ];
  }
  const weakest = lowestHpRatio(state);
  return [
    {
      beat: 1,
      id: "CENTER_CRUSH",
      name: "중앙 압살",
      description: "y=1, y=2의 모든 캐릭터에게 고정 피해 5 · 도발 불가",
      damage: 5,
      tauntable: false,
    },
    {
      beat: 2,
      id: "WEAKNESS_TRACKING",
      name: "약자 추적",
      description: "HP 비율이 가장 낮은 예고 대상에게 고정 피해 7 · 도발 가능",
      damage: 7,
      tauntable: true,
      targetCharacterIds: [weakest],
    },
    {
      beat: 3,
      id: "HEAVY_EARTH_QUAKE",
      name: "강한 대지 진동",
      description: "생존한 모든 아군에게 고정 피해 6 · 도발 불가",
      damage: 6,
      tauntable: false,
    },
  ];
}

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
    description: "실행 위치 바로 오른쪽 1칸을 베어 물리 고정 피해 5를 줍니다.",
    targetType: "NONE",
    phase: "ATTACK",
    value: 5,
    damageType: "PHYSICAL",
    attackPattern: "RIGHT_ONE",
  },
  WARRIOR_SWEEP: {
    id: "WARRIOR_SWEEP",
    owner: "WARRIOR",
    name: "휩쓸기",
    description: "오른쪽 칸과 그 위아래를 휩쓸어 물리 고정 피해 3을 줍니다.",
    targetType: "NONE",
    phase: "ATTACK",
    value: 3,
    damageType: "PHYSICAL",
    attackPattern: "RIGHT_SWEEP",
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
    description: "오른쪽 직선 최대 4칸을 사격합니다. 다른 유닛을 관통하지 않습니다.",
    targetType: "NONE",
    phase: "ATTACK",
    value: 4,
    damageType: "PHYSICAL",
    attackPattern: "RIGHT_LINE_FOUR_BLOCKED",
  },
  ARCHER_ARROW_RAIN: {
    id: "ARCHER_ARROW_RAIN",
    owner: "ARCHER",
    name: "화살비",
    description: "거리 3 이내 중심 타일과 바로 위아래를 공격해 물리 고정 피해 3을 줍니다.",
    targetType: "TILE",
    phase: "ATTACK",
    value: 3,
    damageType: "PHYSICAL",
    maxDistance: 3,
    attackPattern: "VERTICAL_THREE",
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
    attackPattern: "RIGHT_LINE_FOUR_BLOCKED",
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
    description: "거리 3 이내 중심 타일과 상하좌우를 공격해 마법 고정 피해 5를 줍니다.",
    targetType: "TILE",
    phase: "ATTACK",
    value: 5,
    damageType: "MAGIC",
    maxDistance: 3,
    attackPattern: "CROSS_FIVE",
  },
  MAGE_LIGHTNING: {
    id: "MAGE_LIGHTNING",
    owner: "MAGE",
    name: "번개",
    description: "실행 위치와 같은 행의 오른쪽 모든 타일을 관통해 마법 고정 피해 4를 줍니다.",
    targetType: "NONE",
    phase: "ATTACK",
    value: 4,
    damageType: "MAGIC",
    attackPattern: "RIGHT_ROW_ALL",
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
  PRIEST_HOLY_LIGHT: {
    id: "PRIEST_HOLY_LIGHT",
    owner: "PRIEST",
    name: "성광",
    description: "오른쪽 직선 최대 2칸을 비춰 마법 고정 피해 3을 줍니다.",
    targetType: "NONE",
    phase: "ATTACK",
    value: 3,
    damageType: "MAGIC",
    attackPattern: "RIGHT_LINE_TWO",
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
  WARRIOR: ["PASS", "WARRIOR_MOVE", "WARRIOR_SLASH", "WARRIOR_SWEEP", "WARRIOR_TAUNT", "WARRIOR_DEFEND"],
  ARCHER: ["PASS", "ARCHER_MOVE", "ARCHER_SHOT", "ARCHER_ARROW_RAIN", "ARCHER_RETREAT_SHOT", "ARCHER_MARK"],
  MAGE: ["PASS", "MAGE_MOVE", "MAGE_FIREBALL", "MAGE_LIGHTNING", "MAGE_TELEPORT", "MAGE_SHIELD"],
  PRIEST: ["PASS", "PRIEST_MOVE", "PRIEST_HOLY_LIGHT", "PRIEST_HEAL", "PRIEST_GUARD", "PRIEST_MASS_HEAL"],
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
      occupiedTiles: [{ x: 6, y: 1 }, { x: 6, y: 2 }],
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
  const target = livingCharacters(state)[0];
  if (!target) throw new Error("No living character can be tracked");
  return farthestFromBoss(state);
}

export function isPvePlanComplete(plans: PvePlans): boolean {
  return PVE_CHARACTER_ORDER.every((id) => plans[id].every(Boolean));
}
