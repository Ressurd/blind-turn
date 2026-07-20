export type PveBeat = 1 | 2 | 3;

export type PveCharacterId = "WARRIOR" | "ARCHER" | "MAGE" | "PRIEST";

export type PveDamageType = "PHYSICAL" | "MAGIC" | "TRUE";

export type PvePosition = {
  x: number;
  y: number;
};

export type PveCharacterState = {
  id: PveCharacterId;
  name: string;
  token: string;
  hp: number;
  maxHp: number;
  shield: number;
  alive: boolean;
  position: PvePosition;
};

export type PveBossState = {
  id: "TRAINING_GOLEM";
  name: string;
  hp: number;
  maxHp: number;
  marked: boolean;
};

export type PveBattleResult = "IN_PROGRESS" | "VICTORY" | "DEFEAT";

export type PveBattleState = {
  characters: Record<PveCharacterId, PveCharacterState>;
  boss: PveBossState;
  result: PveBattleResult;
};

export type PveActionId =
  | "PASS"
  | "WARRIOR_MOVE"
  | "WARRIOR_SLASH"
  | "WARRIOR_TAUNT"
  | "WARRIOR_DEFEND"
  | "ARCHER_MOVE"
  | "ARCHER_SHOT"
  | "ARCHER_RETREAT_SHOT"
  | "ARCHER_MARK"
  | "MAGE_MOVE"
  | "MAGE_FIREBALL"
  | "MAGE_TELEPORT"
  | "MAGE_SHIELD"
  | "PRIEST_MOVE"
  | "PRIEST_HEAL"
  | "PRIEST_GUARD"
  | "PRIEST_MASS_HEAL";

export type PveActionTargetType = "NONE" | "TILE" | "ALLY";

export type PveResolutionPhase =
  | "PREPARE"
  | "MOVE"
  | "SUPPORT"
  | "ATTACK"
  | "BOSS"
  | "STATUS";

export type PveActionDefinition = {
  id: PveActionId;
  owner: PveCharacterId | "COMMON";
  name: string;
  description: string;
  targetType: PveActionTargetType;
  phase: PveResolutionPhase;
  value?: number;
  damageType?: PveDamageType;
  maxDistance?: number;
};

export type PveActionTarget =
  | { type: "TILE"; position: PvePosition }
  | { type: "ALLY"; characterId: PveCharacterId };

export type PvePlannedAction = {
  actionId: PveActionId;
  target?: PveActionTarget;
};

export type PveActionSlots = [
  PvePlannedAction | null,
  PvePlannedAction | null,
  PvePlannedAction | null,
];

export type PvePlans = Record<PveCharacterId, PveActionSlots>;

export type PveBossIntent = {
  beat: PveBeat;
  id: "COLUMN_SMASH" | "TRACKING_BOLT" | "EARTH_QUAKE";
  name: string;
  description: string;
  damage: number;
  tauntable: boolean;
};

export type PveCombatEventType =
  | "BEAT_STARTED"
  | "ACTION_STARTED"
  | "ACTION_PASSED"
  | "ACTION_FAILED"
  | "MOVED"
  | "TAUNT_APPLIED"
  | "DAMAGE_REDUCTION_APPLIED"
  | "SHIELD_GRANTED"
  | "HEALED"
  | "BOSS_MARKED"
  | "BOSS_DAMAGED"
  | "BOSS_ACTION_STARTED"
  | "CHARACTER_DAMAGED"
  | "CHARACTER_DIED"
  | "BOSS_DEFEATED"
  | "PARTY_DEFEATED"
  | "BEAT_FINISHED"
  | "TURN_FINISHED";

export type PveCombatEvent = {
  id: string;
  beat: PveBeat;
  phase: PveResolutionPhase;
  type: PveCombatEventType;
  message: string;
  actorId?: PveCharacterId | "BOSS" | "SYSTEM" | undefined;
  targetCharacterId?: PveCharacterId | undefined;
  actionId?: PveActionId | undefined;
  damageType?: PveDamageType | undefined;
  amount?: number | undefined;
  rawAmount?: number | undefined;
  reductionRate?: number | undefined;
  shieldAbsorbed?: number | undefined;
  from?: PvePosition | undefined;
  to?: PvePosition | undefined;
  state: PveBattleState;
};

export type PveTurnResolution = {
  state: PveBattleState;
  events: PveCombatEvent[];
  trackingTargetId: PveCharacterId;
};

export type PveValidationResult =
  | { valid: true }
  | { valid: false; reason: string };
