export type PlayerActionType =
  | "ATTACK"
  | "DEFEND"
  | "EVADE"
  | "COUNTER"
  | "PASS";

export type PlayerAction =
  | { type: "ATTACK"; targetPlayerId: string }
  | { type: "DEFEND" }
  | { type: "EVADE" }
  | { type: "COUNTER"; targetPlayerId: string }
  | { type: "PASS" };

export type CreatePlayerInput = {
  id: string;
  nickname: string;
  seatNumber: number;
};

export type PlayerState = {
  id: string;
  nickname: string;
  seatNumber: number;
  hp: number;
  alive: boolean;
  speedRoll: number | null;
  hiddenTieRoll: number | null;
  selectedAction: PlayerAction | null;
  actionResolved: boolean;
  activeDefense: boolean;
  activeEvade: boolean;
  activeCounterTargetId: string | null;
  facingTargetId: string | null;
  previousTurnActionType: PlayerActionType | null;
};

export type GamePhase =
  | "WAITING"
  | "ROLLING_SPEED"
  | "SELECTING_ACTION"
  | "RESOLVING"
  | "FINISHED";

export type GameResult =
  | { type: "WINNER"; winnerPlayerId: string }
  | { type: "DRAW" };

export type ActionSkipReason =
  | "DEAD"
  | "TARGET_DEAD"
  | "ACTION_ALREADY_CONSUMED";

export type BattleEvent =
  | { type: "TURN_STARTED"; turnNumber: number }
  | { type: "SPEED_ROLLED"; playerId: string; speed: number }
  | {
      type: "ACTION_STARTED";
      playerId: string;
      actionType: PlayerActionType;
    }
  | { type: "ATTACK_STARTED"; attackerId: string; targetId: string }
  | { type: "CLASH_STARTED"; playerIds: [string, string] }
  | { type: "CLASH_ROLLED"; playerId: string; roll: number }
  | { type: "CLASH_RESOLVED"; winnerId: string; loserId: string }
  | { type: "DEFENSE_ACTIVATED"; playerId: string }
  | { type: "EVADE_ACTIVATED"; playerId: string }
  | {
      type: "EVADE_ROLLED";
      playerId: string;
      attackerId: string;
      roll: number;
      attackerSpeed: number;
    }
  | { type: "EVADE_SUCCEEDED"; playerId: string }
  | { type: "EVADE_FAILED"; playerId: string }
  | {
      type: "COUNTER_ACTIVATED";
      playerId: string;
      targetPlayerId: string;
    }
  | {
      type: "COUNTER_TRIGGERED";
      counterPlayerId: string;
      attackerId: string;
    }
  | { type: "EXPOSED_ATTACK"; attackerId: string; targetId: string }
  | {
      type: "DAMAGE_APPLIED";
      playerId: string;
      damage: number;
      remainingHp: number;
    }
  | {
      type: "ACTION_SKIPPED";
      playerId: string;
      reason: ActionSkipReason;
    }
  | { type: "PLAYER_DIED"; playerId: string }
  | { type: "GAME_FINISHED"; result: GameResult };

export type GameState = {
  phase: GamePhase;
  turnNumber: number;
  players: PlayerState[];
  actionOrder: string[];
  turnStartHp: Record<string, number>;
  result: GameResult | null;
  pendingEvents: BattleEvent[];
};
