import { HP_SCALE } from "../constants";
import type {
  CardClassId,
  CardDefinition,
  CharacterClassId,
} from "../types";

const hp = (value: number): number => value * HP_SCALE;

const cards = [
  {
    id: "BASE_QUICK_STRIKE",
    name: "속공",
    description: "피해 3 · 합 +2 · 회피 난이도 8",
    category: "ATTACK",
    classId: "BASE",
    targetType: "ENEMY",
    effect: { kind: "ATTACK", damage: hp(3), clashBonus: 2, evadeDifficulty: 8 },
  },
  {
    id: "BASE_HEAVY_STRIKE",
    name: "강공",
    description: "피해 5 · 합 +0 · 회피 난이도 5",
    category: "ATTACK",
    classId: "BASE",
    targetType: "ENEMY",
    effect: { kind: "ATTACK", damage: hp(5), clashBonus: 0, evadeDifficulty: 5 },
  },
  {
    id: "BASE_GUARD",
    name: "방어",
    description: "이 단계에 받는 공격 계열 총 피해를 5 줄입니다.",
    category: "GUARD",
    classId: "BASE",
    targetType: "NONE",
    effect: { kind: "GUARD", guardReduction: hp(5) },
  },
  {
    id: "BASE_EVADE",
    name: "회피",
    description: "각 공격을 회피하며 첫 실패 시 고정 10 피해를 받습니다.",
    category: "EVADE",
    classId: "BASE",
    targetType: "NONE",
    effect: { kind: "EVADE", evadeRollBonus: 0, evadeFailureDamage: hp(10) },
  },
  {
    id: "BASE_COUNTER",
    name: "반격",
    description: "지정 공격자에게 10, 자신에게 2.5 피해를 적용합니다.",
    category: "COUNTER",
    classId: "BASE",
    targetType: "ENEMY",
    effect: {
      kind: "COUNTER",
      counterAttackerDamage: hp(10),
      counterSelfDamage: hp(2.5),
    },
  },
  {
    id: "DUELIST_FLASH_THRUST",
    name: "섬광 찌르기",
    description: "피해 2 · 합 +4 · 회피 난이도 9",
    category: "ATTACK",
    classId: "DUELIST",
    targetType: "ENEMY",
    effect: { kind: "ATTACK", damage: hp(2), clashBonus: 4, evadeDifficulty: 9 },
  },
  {
    id: "DUELIST_BLADE",
    name: "결투의 칼날",
    description: "피해 4 · 합 +2 · 회피 난이도 7",
    category: "ATTACK",
    classId: "DUELIST",
    targetType: "ENEMY",
    effect: { kind: "ATTACK", damage: hp(4), clashBonus: 2, evadeDifficulty: 7 },
  },
  {
    id: "DUELIST_SUPERIOR_FLURRY",
    name: "우세한 연격",
    description: "피해 3 · 합 +1 · 합 승리 시 카드 1장을 뽑습니다.",
    category: "ATTACK",
    classId: "DUELIST",
    targetType: "ENEMY",
    effect: {
      kind: "ATTACK",
      damage: hp(3),
      clashBonus: 1,
      evadeDifficulty: 6,
      special: "DRAW_ON_CLASH_WIN",
    },
  },
  {
    id: "DUELIST_PERFECT_RIPOSTE",
    name: "완벽한 응수",
    description: "지정 공격자에게 8 피해를 주고 자신은 피해를 받지 않습니다.",
    category: "COUNTER",
    classId: "DUELIST",
    targetType: "ENEMY",
    effect: { kind: "COUNTER", counterAttackerDamage: hp(8), counterSelfDamage: 0 },
  },
  {
    id: "BERSERKER_CRUSH",
    name: "분쇄",
    description: "피해 7 · 합 -2 · 회피 난이도 4",
    category: "ATTACK",
    classId: "BERSERKER",
    targetType: "ENEMY",
    effect: { kind: "ATTACK", damage: hp(7), clashBonus: -2, evadeDifficulty: 4 },
  },
  {
    id: "BERSERKER_EXECUTION",
    name: "처형",
    description: "피해 4 · 단계 시작 체력 10 이하 대상에게 추가 3 피해",
    category: "ATTACK",
    classId: "BERSERKER",
    targetType: "ENEMY",
    effect: {
      kind: "ATTACK",
      damage: hp(4),
      clashBonus: 0,
      evadeDifficulty: 6,
      executeThreshold: hp(10),
      executeBonusDamage: hp(3),
      special: "EXECUTE",
    },
  },
  {
    id: "BERSERKER_RECKLESS_SMASH",
    name: "무모한 강타",
    description: "피해 8 · 합 -1 · 회피 난이도 4 · 자신에게 2 피해",
    category: "ATTACK",
    classId: "BERSERKER",
    targetType: "ENEMY",
    effect: {
      kind: "ATTACK",
      damage: hp(8),
      clashBonus: -1,
      evadeDifficulty: 4,
      selfDamage: hp(2),
    },
  },
  {
    id: "BERSERKER_GUARD_BREAK",
    name: "방어 파괴",
    description: "피해 3 · 방어 감소를 최대 3 무시합니다.",
    category: "ATTACK",
    classId: "BERSERKER",
    targetType: "ENEMY",
    effect: {
      kind: "ATTACK",
      damage: hp(3),
      clashBonus: 0,
      evadeDifficulty: 6,
      guardPierce: hp(3),
    },
  },
  {
    id: "GUARDIAN_FORTRESS",
    name: "요새",
    description: "이 단계의 총 공격 피해를 8 줄입니다.",
    category: "GUARD",
    classId: "GUARDIAN",
    targetType: "NONE",
    effect: { kind: "GUARD", guardReduction: hp(8) },
  },
  {
    id: "GUARDIAN_LAYERED_GUARD",
    name: "중첩 방어",
    description: "이 단계의 각 정상 공격 피해를 각각 2 줄입니다.",
    category: "GUARD",
    classId: "GUARDIAN",
    targetType: "NONE",
    effect: { kind: "GUARD", perAttackReduction: hp(2) },
  },
  {
    id: "GUARDIAN_EMERGENCY_HEAL",
    name: "응급 회복",
    description: "체력을 3 회복합니다.",
    category: "UTILITY",
    classId: "GUARDIAN",
    targetType: "SELF",
    effect: { kind: "HEAL", heal: hp(3) },
  },
  {
    id: "GUARDIAN_LAST_STAND",
    name: "최후의 버팀",
    description: "이 단계 피해로 사망할 때 체력 1로 한 번 생존합니다.",
    category: "GUARD",
    classId: "GUARDIAN",
    targetType: "NONE",
    effect: { kind: "LAST_STAND" },
  },
  {
    id: "TACTICIAN_RECYCLE",
    name: "회수",
    description: "버림 더미 카드 한 장을 손패로 가져옵니다.",
    category: "UTILITY",
    classId: "TACTICIAN",
    targetType: "NONE",
    effect: { kind: "RECYCLE" },
  },
  {
    id: "TACTICIAN_SWAP",
    name: "전술 교체",
    description: "손패 카드 최대 2장을 버리고 같은 수만큼 뽑습니다.",
    category: "UTILITY",
    classId: "TACTICIAN",
    targetType: "NONE",
    effect: { kind: "MULLIGAN" },
  },
  {
    id: "TACTICIAN_SIFT",
    name: "선별",
    description: "2장을 뽑고 선택한 손패 1장을 뽑기 더미 아래로 보냅니다.",
    category: "UTILITY",
    classId: "TACTICIAN",
    targetType: "NONE",
    effect: { kind: "SIFT", draw: 2 },
  },
  {
    id: "TACTICIAN_PREDICTIVE_GUARD",
    name: "예측 방어",
    description: "총 공격 피해를 4 줄이고 공격이 없었다면 손패로 돌아옵니다.",
    category: "GUARD",
    classId: "TACTICIAN",
    targetType: "NONE",
    effect: {
      kind: "GUARD",
      guardReduction: hp(4),
      special: "RETURN_IF_NO_ATTACK",
    },
  },
  {
    id: "COMMON_FIRST_AID",
    name: "응급 처치",
    description: "체력을 3 회복합니다.",
    category: "UTILITY",
    classId: "COMMON",
    targetType: "SELF",
    effect: { kind: "HEAL", heal: hp(3) },
  },
  {
    id: "COMMON_FOCUSED_ATTACK",
    name: "집중 공격",
    description: "피해 4 · 합 +1 · 회피 난이도 6",
    category: "ATTACK",
    classId: "COMMON",
    targetType: "ENEMY",
    effect: { kind: "ATTACK", damage: hp(4), clashBonus: 1, evadeDifficulty: 6 },
  },
  {
    id: "COMMON_REINFORCED_GUARD",
    name: "강화 방어",
    description: "이 단계의 총 공격 피해를 6 줄입니다.",
    category: "GUARD",
    classId: "COMMON",
    targetType: "NONE",
    effect: { kind: "GUARD", guardReduction: hp(6) },
  },
  {
    id: "COMMON_SMOKE_EVADE",
    name: "연막 회피",
    description: "회피 주사위에 +2를 얻습니다. 실패 피해는 10입니다.",
    category: "EVADE",
    classId: "COMMON",
    targetType: "NONE",
    effect: { kind: "EVADE", evadeRollBonus: 2, evadeFailureDamage: hp(10) },
  },
  {
    id: "COMMON_GAMBLE",
    name: "도박",
    description: "카드 2장을 뽑고 자신에게 2 피해를 줍니다.",
    category: "UTILITY",
    classId: "COMMON",
    targetType: "SELF",
    effect: { kind: "DRAW", draw: 2, selfDamage: hp(2) },
  },
  {
    id: "COMMON_QUICK_SUPPLY",
    name: "신속 보충",
    description: "카드 1장을 뽑습니다.",
    category: "UTILITY",
    classId: "COMMON",
    targetType: "SELF",
    effect: { kind: "DRAW", draw: 1 },
  },
] as const satisfies readonly CardDefinition[];

export const CARD_CATALOG: Readonly<Record<string, CardDefinition>> =
  Object.fromEntries(cards.map((card) => [card.id, card]));

export const BASE_DECK_CARD_IDS = [
  "BASE_QUICK_STRIKE",
  "BASE_QUICK_STRIKE",
  "BASE_HEAVY_STRIKE",
  "BASE_HEAVY_STRIKE",
  "BASE_GUARD",
  "BASE_GUARD",
  "BASE_EVADE",
  "BASE_COUNTER",
] as const;

export function getCardDefinition(cardId: string): CardDefinition {
  const card = CARD_CATALOG[cardId];
  if (!card) throw new Error(`Unknown card definition: ${cardId}`);
  return card;
}

export function getRewardPool(
  classId: CharacterClassId,
): { classCards: CardDefinition[]; commonCards: CardDefinition[] } {
  const definitions = Object.values(CARD_CATALOG);
  return {
    classCards: definitions.filter((card) => card.classId === classId),
    commonCards: definitions.filter((card) => card.classId === "COMMON"),
  };
}

export function isAttackCard(cardId: string): boolean {
  return getCardDefinition(cardId).category === "ATTACK";
}

export function isCardForClass(
  cardId: string,
  classId: CardClassId,
): boolean {
  return getCardDefinition(cardId).classId === classId;
}
