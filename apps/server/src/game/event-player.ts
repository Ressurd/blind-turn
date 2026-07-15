import type {
  BattleEvent,
  GameState,
  PublicBattleEvent,
  PublicGameSnapshot,
} from "@blind-turn/shared";

export function createPublicEvents(events: BattleEvent[]): PublicBattleEvent[] {
  return events.filter(
    (event): event is PublicBattleEvent => event.type !== "PRIVATE_CARD_DRAWN",
  );
}

export function createPublicSnapshot(state: GameState): PublicGameSnapshot {
  return {
    roundNumber: state.roundNumber,
    players: state.players.map((player) => ({
      playerId: player.id,
      hp: player.hp,
      maxHp: player.maxHp,
      alive: player.alive,
      handCount: player.deckState.hand.length,
    })),
    result: state.result ? { ...state.result } : null,
  };
}
