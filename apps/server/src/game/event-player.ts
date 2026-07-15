import type {
  BattleEvent,
  GameState,
  PublicBattleEvent,
  PublicGameSnapshot,
} from "@blind-turn/shared";

export function createPublicEvents(events: BattleEvent[]): PublicBattleEvent[] {
  return events.map((event) => ({ ...event }));
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
      drawPileCount: player.deckState.drawPile.length,
      discardPileCount: player.deckState.discardPile.length,
      totalDeckCount:
        player.deckState.hand.length
        + player.deckState.drawPile.length
        + player.deckState.discardPile.length,
    })),
    result: state.result ? { ...state.result } : null,
  };
}
