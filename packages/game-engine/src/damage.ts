import { HP_SCALE } from "./constants";
import type { PlayerState } from "./types";

export type DamageResult = {
  player: PlayerState;
  died: boolean;
};

export function applyDamage(
  player: Readonly<PlayerState>,
  damage: number,
): DamageResult {
  if (!Number.isInteger(damage) || damage < 0) {
    throw new Error("Damage must be a non-negative scaled integer");
  }
  const hp = Math.max(0, player.hp - damage);
  const alive = hp > 0;
  return {
    player: { ...player, hp, alive },
    died: player.alive && !alive,
  };
}

export function toDisplayHp(internalHp: number): number {
  return internalHp / HP_SCALE;
}
