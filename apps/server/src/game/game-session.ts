import {
  GameEngineError,
  ProductionRandomSource,
  chooseAutomaticDeckRemovals,
  clearAction,
  cloneGameState,
  confirmAction,
  confirmDeckRemoval as confirmEngineDeckRemoval,
  confirmMissingPlayers,
  confirmRewardSelection,
  createGame,
  haveAllAlivePlayersConfirmed,
  resolveRound,
  selectAction,
  selectRandomPendingRewards,
  startRound,
  updateDeckRemovalSelection,
  updateRewardSelection,
  type CreatePlayerInput,
  type GameState,
  type SelectedTurnAction,
  type RandomSource,
  type RoundResolvedPayload,
} from "@blind-turn/shared";
import { createPublicEvents, createPublicSnapshot } from "./event-player";
import { RoomError } from "../rooms/room-error";

export type RandomSourceFactory = () => RandomSource;

function asRoomError(error: unknown): never {
  if (error instanceof GameEngineError) throw new RoomError(error.code);
  if (error instanceof Error) {
    const known = ["INVALID_GAME_PHASE"] as const;
    const code = known.find((candidate) => error.message.includes(candidate));
    if (code) throw new RoomError(code);
  }
  throw error;
}

export class GameSession {
  private state: GameState | null = null;
  private readonly eventsFinishedPlayerIds = new Set<string>();
  private resolving = false;
  private lastResolvedRound = 0;
  private lastResolvedPayload: RoundResolvedPayload | null = null;

  constructor(
    private readonly randomSourceFactory: RandomSourceFactory = () =>
      new ProductionRandomSource(),
  ) {}

  start(players: CreatePlayerInput[]): GameState {
    this.state = createGame(players, this.randomSourceFactory());
    this.state = startRound(this.state, this.randomSourceFactory());
    this.eventsFinishedPlayerIds.clear();
    this.lastResolvedRound = 0;
    this.lastResolvedPayload = null;
    return this.getState();
  }

  getState(): GameState {
    if (!this.state) throw new RoomError("INVALID_GAME_PHASE");
    return this.state;
  }

  getLastResolvedRound(): number {
    return this.lastResolvedRound;
  }

  getLastResolvedPayload(): RoundResolvedPayload | null {
    return this.lastResolvedPayload
      ? JSON.parse(JSON.stringify(this.lastResolvedPayload)) as RoundResolvedPayload
      : null;
  }

  select(
    playerId: string,
    roundNumber: number,
    input: SelectedTurnAction,
  ): void {
    try {
      this.state = selectAction(this.getState(), playerId, roundNumber, input);
    } catch (error) {
      asRoomError(error);
    }
  }

  clear(
    playerId: string,
    roundNumber: number,
  ): void {
    try {
      this.state = clearAction(this.getState(), playerId, roundNumber);
    } catch (error) {
      asRoomError(error);
    }
  }

  confirm(playerId: string, roundNumber: number): void {
    try {
      this.state = confirmAction(this.getState(), playerId, roundNumber);
    } catch (error) {
      asRoomError(error);
    }
  }

  getConfirmedPlayerIds(): string[] {
    return this.getState().players
      .filter((player) => player.alive && player.deckState.confirmed)
      .map((player) => player.id);
  }

  haveAllAlivePlayersConfirmed(): boolean {
    return haveAllAlivePlayersConfirmed(this.getState());
  }

  resolveCurrentRound(roundNumber: number): RoundResolvedPayload | null {
    const current = this.getState();
    if (
      this.resolving
      || current.roundNumber !== roundNumber
      || this.lastResolvedRound === roundNumber
      || current.phase !== "SELECTING_CARDS"
    ) {
      return null;
    }
    this.resolving = true;
    try {
      const locked = haveAllAlivePlayersConfirmed(current)
        ? cloneGameState(current)
        : confirmMissingPlayers(current);
      const resolution = resolveRound(locked, this.randomSourceFactory());
      this.state = resolution.state;
      this.lastResolvedRound = roundNumber;
      this.eventsFinishedPlayerIds.clear();
      this.lastResolvedPayload = {
        roundNumber,
        events: createPublicEvents(resolution.events),
        publicState: createPublicSnapshot(resolution.state),
      };
      return this.getLastResolvedPayload();
    } catch (error) {
      asRoomError(error);
    } finally {
      this.resolving = false;
    }
  }

  startNextRound(): GameState {
    try {
      this.state = startRound(this.getState(), this.randomSourceFactory());
      this.eventsFinishedPlayerIds.clear();
      this.lastResolvedPayload = null;
      return this.state;
    } catch (error) {
      asRoomError(error);
    }
  }

  updateReward(playerId: string, cardIds: string[]): void {
    try {
      this.state = updateRewardSelection(this.getState(), playerId, cardIds);
    } catch (error) {
      asRoomError(error);
    }
  }

  confirmReward(playerId: string): void {
    try {
      this.state = confirmRewardSelection(
        this.getState(),
        playerId,
        this.randomSourceFactory(),
      );
    } catch (error) {
      asRoomError(error);
    }
  }

  chooseRandomRewards(): void {
    try {
      this.state = selectRandomPendingRewards(
        this.getState(),
        this.randomSourceFactory(),
      );
    } catch (error) {
      asRoomError(error);
    }
  }

  updateDeckRemoval(playerId: string, instanceIds: string[]): void {
    try {
      this.state = updateDeckRemovalSelection(
        this.getState(),
        playerId,
        instanceIds,
      );
    } catch (error) {
      asRoomError(error);
    }
  }

  confirmDeckRemoval(playerId: string): void {
    try {
      this.state = confirmEngineDeckRemoval(this.getState(), playerId);
    } catch (error) {
      asRoomError(error);
    }
  }

  removeAutomaticDeckCards(): void {
    let next = this.getState();
    const playerIds = next.players.filter(
      (candidate) =>
        candidate.alive
        && candidate.deckState.requiredRemovalCount > 0
        && !candidate.deckState.deckRemovalConfirmed,
    ).map((player) => player.id);
    for (const playerId of playerIds) {
      const player = next.players.find((candidate) => candidate.id === playerId)!;
      next = updateDeckRemovalSelection(
        next,
        playerId,
        chooseAutomaticDeckRemovals(player),
      );
      next = confirmEngineDeckRemoval(next, playerId);
    }
    this.state = next;
  }

  markEventsFinished(playerId: string, roundNumber: number): void {
    if (roundNumber !== this.lastResolvedRound) {
      throw new RoomError("ROUND_NUMBER_MISMATCH");
    }
    this.eventsFinishedPlayerIds.add(playerId);
  }

  havePlayersFinishedEvents(playerIds: string[]): boolean {
    return playerIds.every((playerId) => this.eventsFinishedPlayerIds.has(playerId));
  }
}
