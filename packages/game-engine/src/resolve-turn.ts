import { MAX_HP, MAX_PLAYERS, MIN_PLAYERS } from "./constants";
import { rollInitiative } from "./initiative";
import type { RandomSource } from "./random";
import { resolvePlayerAction } from "./resolve-action";
import type {
  BattleEvent,
  CreatePlayerInput,
  GameState,
  PlayerAction,
  PlayerState,
} from "./types";

function cloneAction(action: PlayerAction | null): PlayerAction | null {
  return action ? { ...action } : null;
}

export function cloneGameState(state: Readonly<GameState>): GameState {
  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      selectedAction: cloneAction(player.selectedAction),
    })),
    actionOrder: [...state.actionOrder],
    turnStartHp: { ...state.turnStartHp },
    result: state.result ? { ...state.result } : null,
    pendingEvents: [...state.pendingEvents],
  };
}

function validatePlayers(players: readonly CreatePlayerInput[]): void {
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw new Error(`A game requires ${MIN_PLAYERS} to ${MAX_PLAYERS} players`);
  }
  const ids = new Set<string>();
  const seats = new Set<number>();
  for (const player of players) {
    if (!player.id.trim()) throw new Error("Player id cannot be empty");
    if (!player.nickname.trim()) throw new Error("Nickname cannot be empty");
    if (!Number.isInteger(player.seatNumber) || player.seatNumber < 1) {
      throw new Error("Seat number must be a positive integer");
    }
    if (ids.has(player.id)) throw new Error(`Duplicate player id: ${player.id}`);
    if (seats.has(player.seatNumber)) {
      throw new Error(`Duplicate seat number: ${player.seatNumber}`);
    }
    ids.add(player.id);
    seats.add(player.seatNumber);
  }
}

export function createGame(players: CreatePlayerInput[]): GameState {
  validatePlayers(players);
  const playerStates: PlayerState[] = players.map((player) => ({
    id: player.id,
    nickname: player.nickname.trim(),
    seatNumber: player.seatNumber,
    hp: MAX_HP,
    alive: true,
    speedRoll: null,
    hiddenTieRoll: null,
    selectedAction: null,
    actionResolved: false,
    activeDefense: false,
    activeEvade: false,
    activeCounterTargetId: null,
    facingTargetId: null,
    previousTurnActionType: null,
  }));
  return {
    phase: "WAITING",
    turnNumber: 0,
    players: playerStates,
    actionOrder: [],
    turnStartHp: {},
    result: null,
    pendingEvents: [],
  };
}

export function startTurn(
  state: GameState,
  randomSource: RandomSource,
): GameState {
  if (state.phase !== "WAITING") {
    throw new Error(`Cannot start a turn during phase ${state.phase}`);
  }
  const nextState = cloneGameState(state);
  const turnNumber = state.turnNumber + 1;
  nextState.phase = "ROLLING_SPEED";
  nextState.turnNumber = turnNumber;
  nextState.actionOrder = [];
  nextState.result = null;
  nextState.players = nextState.players.map((player) => ({
    ...player,
    speedRoll: null,
    hiddenTieRoll: null,
    selectedAction: null,
    actionResolved: false,
    activeDefense: false,
    activeEvade: false,
    activeCounterTargetId: null,
    facingTargetId: null,
  }));
  nextState.turnStartHp = Object.fromEntries(
    nextState.players
      .filter((player) => player.alive)
      .map((player) => [player.id, player.hp]),
  );

  const initiative = rollInitiative(
    nextState.players,
    nextState.turnStartHp,
    randomSource,
  );
  nextState.players = initiative.players;
  nextState.actionOrder = initiative.actionOrder;
  nextState.pendingEvents = [
    { type: "TURN_STARTED", turnNumber },
    ...initiative.events,
  ];
  nextState.phase = "SELECTING_ACTION";
  return nextState;
}

function validateActionTarget(
  state: GameState,
  player: PlayerState,
  targetPlayerId: string,
): void {
  if (targetPlayerId === player.id) {
    throw new Error("A player cannot target themselves");
  }
  const target = state.players.find((candidate) => candidate.id === targetPlayerId);
  if (!target) throw new Error(`Unknown target: ${targetPlayerId}`);
  if (!target.alive) throw new Error("A dead player cannot be targeted");
}

export function submitAction(
  state: GameState,
  playerId: string,
  action: PlayerAction,
): GameState {
  if (state.phase !== "SELECTING_ACTION") {
    throw new Error(`Cannot submit actions during phase ${state.phase}`);
  }
  const nextState = cloneGameState(state);
  const player = nextState.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error(`Unknown player: ${playerId}`);
  if (!player.alive) throw new Error("A dead player cannot act");
  if (player.selectedAction) throw new Error("Player already submitted an action");

  if (action.type === "ATTACK" || action.type === "COUNTER") {
    validateActionTarget(nextState, player, action.targetPlayerId);
  }
  if (
    action.type === "COUNTER" &&
    player.previousTurnActionType === "COUNTER"
  ) {
    throw new Error("COUNTER cannot be selected on consecutive turns");
  }

  player.selectedAction = { ...action };
  const allSubmitted = nextState.players
    .filter((candidate) => candidate.alive)
    .every((candidate) => candidate.selectedAction !== null);
  if (allSubmitted) nextState.phase = "RESOLVING";
  return nextState;
}

export function resolveTurn(
  state: GameState,
  randomSource: RandomSource,
): { state: GameState; events: BattleEvent[] } {
  if (state.phase !== "RESOLVING") {
    throw new Error(`Cannot resolve a turn during phase ${state.phase}`);
  }
  const nextState = cloneGameState(state);
  const events: BattleEvent[] = [...nextState.pendingEvents];
  nextState.phase = "RESOLVING";

  for (const playerId of nextState.actionOrder) {
    resolvePlayerAction({ state: nextState, events, randomSource }, playerId);
  }

  nextState.players = nextState.players.map((player) => ({
    ...player,
    previousTurnActionType:
      player.selectedAction?.type ?? player.previousTurnActionType,
    activeDefense: false,
    activeEvade: false,
    activeCounterTargetId: null,
  }));
  nextState.pendingEvents = [];

  const survivors = nextState.players.filter((player) => player.alive);
  if (survivors.length <= 1) {
    nextState.result =
      survivors.length === 1
        ? { type: "WINNER", winnerPlayerId: survivors[0]!.id }
        : { type: "DRAW" };
    nextState.phase = "FINISHED";
    events.push({ type: "GAME_FINISHED", result: nextState.result });
  } else {
    nextState.phase = "WAITING";
    nextState.result = null;
  }

  return { state: nextState, events };
}
