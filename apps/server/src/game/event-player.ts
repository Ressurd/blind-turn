import type {
  BattleEvent,
  PublicBattleEvent,
  PublicGameSnapshot,
} from "@blind-turn/shared";
import type { GameState } from "@blind-turn/shared";

export function createPublicEvents(events: BattleEvent[]): PublicBattleEvent[] {
  return events.filter(
    (event): event is PublicBattleEvent => event.type !== "SPEED_ROLLED",
  );
}

export function createPublicSnapshot(state: GameState): PublicGameSnapshot {
  return {
    turnNumber: state.turnNumber,
    players: state.players.map((player) => ({
      playerId: player.id,
      hp: player.hp,
      alive: player.alive,
    })),
    result: state.result ? { ...state.result } : null,
  };
}
