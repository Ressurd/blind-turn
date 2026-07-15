import { CHARACTER_CATALOG } from "../characters/character-catalog";
import { MAX_PLAYERS, MIN_PLAYERS } from "../constants";
import {
  cloneDeckState,
  createInitialDeckState,
  drawCards,
  selectInitialTacticianHand,
} from "../deck/deck-state";
import { ProductionRandomSource, type RandomSource } from "../random";
import type {
  BattleEvent,
  CreatePlayerInput,
  GameState,
  PlayerState,
} from "../types";

function appendDrawEvents(
  events: BattleEvent[],
  playerId: string,
  drawn: ReturnType<typeof drawCards>,
): void {
  if (drawn.reshuffled) {
    events.push(
      {
        type: "DISCARD_RESHUFFLE_STARTED",
        playerId,
        discardCount: drawn.reshuffled.discardCount,
      },
      {
        type: "DISCARD_RESHUFFLED",
        playerId,
        drawPileCount: drawn.reshuffled.drawPileCount,
      },
    );
  }
  if (drawn.drawn.length > 0) {
    events.push({
      type: "CARD_DRAWN",
      playerId,
      count: drawn.drawn.length,
      drawPileCount: drawn.state.drawPile.length,
      handCount: drawn.state.hand.length,
    });
  }
}

function validatePlayers(players: readonly CreatePlayerInput[]): void {
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw new Error(`A game requires ${MIN_PLAYERS} to ${MAX_PLAYERS} players`);
  }
  const ids = new Set<string>();
  const seats = new Set<number>();
  for (const player of players) {
    if (!player.id.trim() || !player.nickname.trim()) {
      throw new Error("Player id and nickname are required");
    }
    if (ids.has(player.id) || seats.has(player.seatNumber)) {
      throw new Error("Player ids and seat numbers must be unique");
    }
    ids.add(player.id);
    seats.add(player.seatNumber);
  }
}

export function cloneGameState(state: Readonly<GameState>): GameState {
  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      deckState: cloneDeckState(player.deckState),
    })),
    result: state.result ? { ...state.result } : null,
    pendingEvents: state.pendingEvents.map((event) => ({ ...event })),
  };
}

export function createGame(
  players: CreatePlayerInput[],
  randomSource: RandomSource = new ProductionRandomSource(),
): GameState {
  validatePlayers(players);
  const playerStates: PlayerState[] = players.map((input) => {
    const character = CHARACTER_CATALOG[input.characterId];
    return {
      id: input.id,
      nickname: input.nickname.trim(),
      seatNumber: input.seatNumber,
      characterId: input.characterId,
      maxHp: character.maxHp,
      hp: character.maxHp,
      alive: true,
      deckState: createInitialDeckState(
        input.id,
        input.characterId,
        randomSource,
      ),
    };
  });
  return {
    phase: "ROUND_STARTING",
    roundNumber: 0,
    players: playerStates,
    result: null,
    pendingEvents: [],
  } satisfies GameState;
}

export function hasPendingInitialHandSelection(state: GameState): boolean {
  return state.players.some(
    (player) => player.deckState.pendingInitialHandSelection.length > 0,
  );
}

export function chooseInitialHand(
  state: GameState,
  playerId: string,
  selectedInstanceIds: readonly string[],
): GameState {
  if (state.phase !== "ROUND_STARTING" || state.roundNumber !== 0) {
    throw new Error("INVALID_GAME_PHASE");
  }
  const next = cloneGameState(state);
  const player = next.players.find((candidate) => candidate.id === playerId);
  if (!player || player.characterId !== "TACTICIAN") {
    throw new Error("INITIAL_HAND_SELECTION_REQUIRED");
  }
  player.deckState = selectInitialTacticianHand(
    player.deckState,
    selectedInstanceIds,
  );
  return next;
}

export function startRound(
  state: GameState,
  randomSource: RandomSource,
): GameState {
  if (state.phase !== "ROUND_STARTING") {
    throw new Error("INVALID_GAME_PHASE");
  }
  if (hasPendingInitialHandSelection(state)) {
    throw new Error("INITIAL_HAND_SELECTION_REQUIRED");
  }
  const next = cloneGameState(state);
  next.roundNumber += 1;
  next.phase = "SELECTING_CARDS";
  next.pendingEvents = [{ type: "ROUND_STARTED", roundNumber: next.roundNumber }];
  next.players = next.players.map((player) => {
    if (!player.alive) return player;
    const deckState = cloneDeckState(player.deckState);
    deckState.queuedCards = [];
    deckState.confirmed = false;
    if (next.roundNumber === 1) return { ...player, deckState };
    const drawn = drawCards(deckState, 1, randomSource);
    appendDrawEvents(next.pendingEvents, player.id, drawn);
    return { ...player, deckState: drawn.state };
  });
  return next;
}
