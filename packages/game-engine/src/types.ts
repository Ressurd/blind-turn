export type CharacterClassId =
  | "DUELIST"
  | "BERSERKER"
  | "GUARDIAN"
  | "TACTICIAN";

export type CardClassId = CharacterClassId | "COMMON" | "BASE";

export type CardCategory =
  | "ATTACK"
  | "GUARD"
  | "EVADE"
  | "COUNTER"
  | "UTILITY";

export type CardTargetType = "NONE" | "ENEMY" | "SELF";

export type CardEffectKind =
  | "ATTACK"
  | "GUARD"
  | "EVADE"
  | "COUNTER"
  | "HEAL"
  | "DRAW"
  | "RECYCLE"
  | "MULLIGAN"
  | "SIFT"
  | "LAST_STAND";

export type CardSpecialRule =
  | "DRAW_ON_CLASH_WIN"
  | "EXECUTE"
  | "RETURN_IF_NO_ATTACK";

export type CardEffectDefinition = {
  kind: CardEffectKind;
  damage?: number;
  clashBonus?: number;
  evadeDifficulty?: number;
  guardReduction?: number;
  perAttackReduction?: number;
  guardPierce?: number;
  counterAttackerDamage?: number;
  counterSelfDamage?: number;
  evadeRollBonus?: number;
  evadeFailureDamage?: number;
  heal?: number;
  draw?: number;
  selfDamage?: number;
  executeThreshold?: number;
  executeBonusDamage?: number;
  special?: CardSpecialRule;
};

export type CardDefinition = {
  id: string;
  name: string;
  description: string;
  category: CardCategory;
  classId: CardClassId;
  targetType: CardTargetType;
  effect: CardEffectDefinition;
};

export type ActionCardInstance = {
  instanceId: string;
  cardId: string;
};

export type SelectedActionAdditionalSelection =
  | { discardCardInstanceId: string }
  | { handCardInstanceIds: string[] }
  | { returnCardInstanceId: string }
  | null;

export type SelectedTurnAction = {
  cardInstanceId: string;
  targetPlayerId?: string;
  additionalSelection?: SelectedActionAdditionalSelection;
};

export type PlayerDeckState = {
  drawPile: ActionCardInstance[];
  hand: ActionCardInstance[];
  discardPile: ActionCardInstance[];
  permanentlyRemovedCards: ActionCardInstance[];
  selectedAction: SelectedTurnAction | null;
  confirmed: boolean;
  pendingRewardOptions: string[];
  selectedRewardCardIds: string[];
  rewardConfirmed: boolean;
  requiredRemovalCount: number;
  selectedRemovalInstanceIds: string[];
  newlyAddedCardInstanceIds: string[];
  deckRemovalConfirmed: boolean;
  nextInstanceNumber: number;
};

export type CreatePlayerInput = {
  id: string;
  nickname: string;
  seatNumber: number;
  characterId: CharacterClassId;
};

export type PlayerState = {
  id: string;
  nickname: string;
  seatNumber: number;
  characterId: CharacterClassId;
  maxHp: number;
  hp: number;
  alive: boolean;
  deckState: PlayerDeckState;
};

export type GamePhase =
  | "ROUND_STARTING"
  | "SELECTING_CARDS"
  | "RESOLVING_ROUND"
  | "SELECTING_REWARD"
  | "SELECTING_DECK_REMOVAL"
  | "FINISHED";

export type GameResult =
  | { type: "WINNER"; winnerPlayerId: string }
  | { type: "DRAW" };

export type DamageSource =
  | "ATTACK"
  | "COUNTER"
  | "SELF"
  | "EVADE_FAILURE";

export type BattleEvent =
  | { type: "ROUND_STARTED"; roundNumber: number }
  | {
      type: "ROUND_LOCKED";
      roundNumber: number;
      cardCounts: Array<{ playerId: string; count: number }>;
    }
  | { type: "TURN_RESOLUTION_STARTED"; roundNumber: number }
  | {
      type: "CARD_REVEALED";
      roundNumber: number;
      playerId: string;
      cardInstanceId: string;
      cardId: string;
      targetPlayerId?: string;
    }
  | {
      type: "ATTACK_STARTED";
      attackerId: string;
      targetId: string;
      cardId: string;
      damage: number;
    }
  | {
      type: "CLASH_STARTED";
      playerIds: [string, string];
      cardIds: [string, string];
    }
  | {
      type: "CLASH_ROLLED";
      playerId: string;
      roll: number;
      bonus: number;
      total: number;
    }
  | {
      type: "CLASH_RESOLVED";
      winnerId: string;
      loserId: string;
    }
  | {
      type: "GUARD_ACTIVATED";
      playerId: string;
      reduction: number;
      mode: "TOTAL" | "PER_ATTACK" | "LAST_STAND";
    }
  | {
      type: "GUARD_RESOLVED";
      playerId: string;
      incomingDamage: number;
      reducedDamage: number;
      finalDamage: number;
    }
  | {
      type: "EVADE_ROLLED";
      playerId: string;
      attackerId: string;
      roll: number;
      bonus: number;
      difficulty: number;
      succeeded: boolean;
    }
  | { type: "EVADE_FAILED"; playerId: string }
  | {
      type: "COUNTER_TRIGGERED";
      counterPlayerId: string;
      attackerId: string;
      attackerDamage: number;
      counterDamage: number;
    }
  | {
      type: "HEAL_APPLIED";
      playerId: string;
      amount: number;
      remainingHp: number;
    }
  | {
      type: "DAMAGE_APPLIED";
      playerId: string;
      damage: number;
      remainingHp: number;
      source: DamageSource;
    }
  | { type: "LAST_STAND_TRIGGERED"; playerId: string }
  | { type: "PLAYER_DIED"; playerId: string }
  | { type: "TURN_RESOLUTION_FINISHED"; roundNumber: number }
  | { type: "ROUND_FINISHED"; roundNumber: number }
  | {
      type: "DISCARD_RESHUFFLE_STARTED";
      playerId: string;
      discardCount: number;
    }
  | {
      type: "DISCARD_RESHUFFLED";
      playerId: string;
      drawPileCount: number;
    }
  | {
      type: "CARD_DRAWN";
      playerId: string;
      count: number;
      drawPileCount: number;
      handCount: number;
    }
  | { type: "GAME_FINISHED"; result: GameResult };

export type GameState = {
  phase: GamePhase;
  roundNumber: number;
  players: PlayerState[];
  result: GameResult | null;
  pendingEvents: BattleEvent[];
};

export type GameErrorCode =
  | "CARD_NOT_IN_HAND"
  | "INVALID_CARD_TARGET"
  | "INVALID_ADDITIONAL_SELECTION"
  | "ROUND_ALREADY_CONFIRMED"
  | "ROUND_NUMBER_MISMATCH"
  | "INVALID_GAME_PHASE"
  | "PLAYER_DEAD"
  | "REWARD_OPTION_NOT_FOUND"
  | "INVALID_REWARD_SELECTION"
  | "INVALID_DECK_REMOVAL"
  | "ATTACK_CARD_REQUIRED";
