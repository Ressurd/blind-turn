import { GUARDIAN_MAX_HP, MAX_HP } from "../constants";
import type { CharacterClassId } from "../types";

export type CharacterDefinition = {
  id: CharacterClassId;
  name: string;
  passive: string;
  playStyle: string;
  maxHp: number;
};

export const CHARACTER_CATALOG: Record<CharacterClassId, CharacterDefinition> = {
  DUELIST: {
    id: "DUELIST",
    name: "결투가",
    passive: "모든 합 최종값에 +1을 얻습니다.",
    playStyle: "속공과 일대일 합에 강합니다.",
    maxHp: MAX_HP,
  },
  BERSERKER: {
    id: "BERSERKER",
    name: "광전사",
    passive: "직접 공격 카드 피해가 1 증가합니다.",
    playStyle: "높은 피해와 자해를 교환합니다.",
    maxHp: MAX_HP,
  },
  GUARDIAN: {
    id: "GUARDIAN",
    name: "수호자",
    passive: "최대 체력과 시작 체력이 35입니다.",
    playStyle: "피해 감소와 생존에 특화됩니다.",
    maxHp: GUARDIAN_MAX_HP,
  },
  TACTICIAN: {
    id: "TACTICIAN",
    name: "전술가",
    passive: "시작 카드 6장을 보고 5장을 선택합니다.",
    playStyle: "손패 순환과 카드 회수에 강합니다.",
    maxHp: MAX_HP,
  },
};

export const CHARACTER_CLASS_IDS = Object.keys(
  CHARACTER_CATALOG,
) as CharacterClassId[];
