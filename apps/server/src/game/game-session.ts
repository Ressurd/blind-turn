import {
  GameEngineError,
  ProductionRandomSource,
  chooseAutomaticDeckRemoval,
  chooseInitialHand,
  cloneGameState,
  confirmMissingPlayers,
  confirmRound,
  createGame,
  haveAllAlivePlayersConfirmed,
  hasPendingInitialHandSelection,
  queueCard,
  removeQueuedCard,
  reorderQueuedCards,
  resolveRound,
  selectDeckRemoval,
  selectRandomPendingRewards,
  selectReward,
  startRound,
  type CreatePlayerInput,
  type GameState,
  type QueuedCardAction,
  type RandomSource,
  type RoundResolvedPayload,
} from "@blind-turn/shared";
import { createPublicEvents, createPublicSnapshot } from "./event-player";
import { RoomError } from "../rooms/room-error";

export type RandomSourceFactory = () => RandomSource;

function asRoomError(error: unknown): never {
  if (error instanceof GameEngineError) throw new RoomError(error.code);
  if (error instanceof Error) {
    const known = [
      "INVALID_GAME_PHASE",
      "INITIAL_HAND_SELECTION_REQUIRED",
    ] as const;
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
    if (!hasPendingInitialHandSelection(this.state)) {
      this.state = startRound(this.state, this.randomSourceFactory());
    }
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

  selectInitialHand(playerId: string, selectedInstanceIds: string[]): void {
    try {
      this.state = chooseInitialHand(
        this.getState(),
        playerId,
        selectedInstanceIds,
      );
      if (!hasPendingInitialHandSelection(this.state)) {
        this.state = startRound(this.state, this.randomSourceFactory());
      }
    } catch (error) {
      asRoomError(error);
    }
  }

  queue(
    playerId: string,
    roundNumber: number,
    input: Omit<QueuedCardAction, "order">,
  ): void {
    try {
      this.state = queueCard(this.getState(), playerId, roundNumber, input);
    } catch (error) {
      asRoomError(error);
    }
  }

  removeQueued(playerId: string, roundNumber: number, instanceId: string): void {
    try {
      this.state = removeQueuedCard(
        this.getState(),
        playerId,
        roundNumber,
        instanceId,
      );
    } catch (error) {
      asRoomError(error);
    }
  }

  reorderQueued(
    playerId: string,
    roundNumber: number,
    instanceIds: string[],
  ): void {
    try {
      this.state = reorderQueuedCards(
        this.getState(),
        playerId,
        roundNumber,
        instanceIds,
      );
    } catch (error) {
      asRoomError(error);
    }
  }

  confirm(playerId: string, roundNumber: number): void {
    try {
      this.state = confirmRound(this.getState(), playerId, roundNumber);
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

  chooseReward(playerId: string, cardId: string): void {
    try {
      this.state = selectReward(
        this.getState(),
        playerId,
        cardId,
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

  removeDeckCard(playerId: string, instanceId: string): void {
    try {
      this.state = selectDeckRemoval(
        this.getState(),
        playerId,
        instanceId,
        this.randomSourceFactory(),
      );
    } catch (error) {
      asRoomError(error);
    }
  }

  removeAutomaticDeckCards(): void {
    let next = this.getState();
    for (const player of next.players.filter(
      (candidate) => candidate.alive && candidate.deckState.pendingRemovalRequired,
    )) {
      next = selectDeckRemoval(
        next,
        player.id,
        chooseAutomaticDeckRemoval(player),
        this.randomSourceFactory(),
      );
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
