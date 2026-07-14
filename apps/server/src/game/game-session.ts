import {
  ProductionRandomSource,
  createGame,
  resolveTurn,
  startTurn,
  submitAction,
  type CreatePlayerInput,
  type GameState,
  type PlayerAction,
  type RandomSource,
  type TurnResolvedPayload,
} from "@blind-turn/shared";
import { createPublicEvents, createPublicSnapshot } from "./event-player";
import { RoomError } from "../rooms/room-error";

export type RandomSourceFactory = () => RandomSource;

export class GameSession {
  private state: GameState | null = null;
  private readonly submittedPlayerIds = new Set<string>();
  private readonly eventsFinishedPlayerIds = new Set<string>();
  private resolving = false;
  private lastResolvedTurn = 0;

  constructor(
    private readonly randomSourceFactory: RandomSourceFactory = () =>
      new ProductionRandomSource(),
  ) {}

  start(players: CreatePlayerInput[]): GameState {
    this.state = startTurn(createGame(players), this.randomSourceFactory());
    this.submittedPlayerIds.clear();
    this.eventsFinishedPlayerIds.clear();
    this.lastResolvedTurn = 0;
    return this.getState();
  }

  getState(): GameState {
    if (!this.state) throw new RoomError("INVALID_GAME_PHASE");
    return this.state;
  }

  getSubmittedPlayerIds(): string[] {
    return [...this.submittedPlayerIds];
  }

  isSubmitted(playerId: string): boolean {
    return this.submittedPlayerIds.has(playerId);
  }

  getLastResolvedTurn(): number {
    return this.lastResolvedTurn;
  }

  submit(playerId: string, turnNumber: number, action: PlayerAction): void {
    const state = this.getState();
    if (state.turnNumber !== turnNumber) {
      throw new RoomError("TURN_NUMBER_MISMATCH");
    }
    if (state.phase !== "SELECTING_ACTION") {
      throw new RoomError("INVALID_GAME_PHASE");
    }
    const player = state.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new RoomError("PLAYER_NOT_FOUND");
    if (!player.alive) throw new RoomError("PLAYER_DEAD");
    if (this.submittedPlayerIds.has(playerId)) {
      throw new RoomError("ACTION_ALREADY_SUBMITTED");
    }

    try {
      this.state = submitAction(state, playerId, action);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid action";
      const targetError = /target|Target|themselves|dead player/.test(message);
      throw new RoomError(targetError ? "INVALID_TARGET" : "INVALID_ACTION");
    }
    this.submittedPlayerIds.add(playerId);
  }

  haveAllAlivePlayersSubmitted(): boolean {
    return this.getState()
      .players.filter((player) => player.alive)
      .every((player) => this.submittedPlayerIds.has(player.id));
  }

  resolveCurrentTurn(turnNumber: number): TurnResolvedPayload | null {
    const state = this.getState();
    if (
      this.resolving ||
      state.turnNumber !== turnNumber ||
      this.lastResolvedTurn === turnNumber ||
      (state.phase !== "SELECTING_ACTION" && state.phase !== "RESOLVING")
    ) {
      return null;
    }

    this.resolving = true;
    try {
      let submittedState = state;
      for (const player of state.players.filter((candidate) => candidate.alive)) {
        if (this.submittedPlayerIds.has(player.id)) continue;
        submittedState = submitAction(submittedState, player.id, { type: "PASS" });
        this.submittedPlayerIds.add(player.id);
      }
      if (submittedState.phase !== "RESOLVING") {
        throw new RoomError("INVALID_GAME_PHASE");
      }
      const resolution = resolveTurn(submittedState, this.randomSourceFactory());
      this.state = resolution.state;
      this.lastResolvedTurn = turnNumber;
      this.eventsFinishedPlayerIds.clear();
      return {
        turnNumber,
        events: createPublicEvents(resolution.events),
        publicState: createPublicSnapshot(resolution.state),
      };
    } finally {
      this.resolving = false;
    }
  }

  startNextTurn(): GameState {
    const state = this.getState();
    if (state.phase !== "WAITING") throw new RoomError("INVALID_GAME_PHASE");
    this.state = startTurn(state, this.randomSourceFactory());
    this.submittedPlayerIds.clear();
    this.eventsFinishedPlayerIds.clear();
    return this.state;
  }

  markEventsFinished(playerId: string, turnNumber: number): void {
    if (turnNumber !== this.lastResolvedTurn) {
      throw new RoomError("TURN_NUMBER_MISMATCH");
    }
    this.eventsFinishedPlayerIds.add(playerId);
  }

  havePlayersFinishedEvents(playerIds: string[]): boolean {
    return playerIds.every((playerId) => this.eventsFinishedPlayerIds.has(playerId));
  }
}
