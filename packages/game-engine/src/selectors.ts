import { HP_SCALE } from "./constants";
import type { GameState, PlayerState } from "./types";

export function getAlivePlayers(state: Readonly<GameState>): PlayerState[] {
  return state.players.filter((player) => player.alive);
}

export function getPlayer(
  state: Readonly<GameState>,
  playerId: string,
): PlayerState | undefined {
  return state.players.find((player) => player.id === playerId);
}

export function getOrderedPlayers(state: Readonly<GameState>): PlayerState[] {
  return state.actionOrder
    .map((playerId) => getPlayer(state, playerId))
    .filter((player): player is PlayerState => Boolean(player));
}

export function formatHp(internalHp: number): string {
  const displayHp = internalHp / HP_SCALE;
  return Number.isInteger(displayHp) ? String(displayHp) : displayHp.toFixed(1);
}
