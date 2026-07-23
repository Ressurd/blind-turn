import { z } from "zod";

export const NicknameSchema = z.string().trim().min(1).max(12);
export const RoomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
export const CharacterClassIdSchema = z.enum([
  "DUELIST",
  "BERSERKER",
  "GUARDIAN",
  "TACTICIAN",
]);
export const PveCharacterIdSchema = z.enum([
  "WARRIOR",
  "ARCHER",
  "MAGE",
  "PRIEST",
]);
export const RoomCreatePayloadSchema = z.object({ nickname: NicknameSchema });
export const RoomJoinPayloadSchema = z.object({
  roomCode: RoomCodeSchema,
  nickname: NicknameSchema,
});
export const RoomReconnectPayloadSchema = z.object({
  roomCode: RoomCodeSchema,
  playerId: z.string().min(1),
  reconnectToken: z.string().min(20),
});
export const RoomCodePayloadSchema = z.object({ roomCode: RoomCodeSchema });
export const SelectCharacterPayloadSchema = z.object({
  roomCode: RoomCodeSchema,
  characterId: CharacterClassIdSchema,
});
export const SetReadyPayloadSchema = z.object({
  roomCode: RoomCodeSchema,
  ready: z.boolean(),
});
const AdditionalSelectionSchema = z.union([
  z.object({ discardCardInstanceId: z.string().min(1) }),
  z.object({ handCardInstanceIds: z.array(z.string().min(1)).max(2) }),
  z.object({ returnCardInstanceId: z.string().min(1) }),
  z.null(),
]);

export const SelectActionPayloadSchema = z.object({
  roomCode: RoomCodeSchema,
  roundNumber: z.number().int().positive(),
  cardInstanceId: z.string().min(1),
  targetPlayerId: z.string().min(1).optional(),
  additionalSelection: AdditionalSelectionSchema.optional(),
});
export const ClearActionPayloadSchema = z.object({
  roomCode: RoomCodeSchema,
  roundNumber: z.number().int().positive(),
});
export const ConfirmActionPayloadSchema = z.object({
  roomCode: RoomCodeSchema,
  roundNumber: z.number().int().positive(),
});
export const EventsFinishedPayloadSchema = z.object({
  roomCode: RoomCodeSchema,
  roundNumber: z.number().int().positive(),
});
export const UpdateRewardSelectionPayloadSchema = z.object({
  roomCode: RoomCodeSchema,
  selectedCardIds: z.array(z.string().min(1)).max(2),
});
export const UpdateDeckRemovalPayloadSchema = z.object({
  roomCode: RoomCodeSchema,
  selectedInstanceIds: z.array(z.string().min(1)).max(15),
});
export const ChatSendPayloadSchema = z.object({
  roomCode: RoomCodeSchema,
  message: z.string(),
});

const PvePositionSchema = z.object({
  x: z.number().int().min(0).max(6),
  y: z.number().int().min(0).max(3),
});
const PveActionTargetSchema = z.union([
  z.object({ type: z.literal("TILE"), position: PvePositionSchema }),
  z.object({ type: z.literal("ALLY"), characterId: PveCharacterIdSchema }),
]);
const PveActionIdSchema = z.enum([
  "PASS", "WARRIOR_MOVE", "WARRIOR_SLASH", "WARRIOR_SWEEP",
  "WARRIOR_TAUNT", "WARRIOR_DEFEND", "ARCHER_MOVE", "ARCHER_SHOT",
  "ARCHER_ARROW_RAIN", "ARCHER_RETREAT_SHOT", "ARCHER_MARK", "MAGE_MOVE",
  "MAGE_FIREBALL", "MAGE_LIGHTNING", "MAGE_TELEPORT", "MAGE_SHIELD",
  "PRIEST_MOVE", "PRIEST_HOLY_LIGHT", "PRIEST_HEAL", "PRIEST_GUARD",
  "PRIEST_MASS_HEAL",
]);
export const PveSelectCharacterPayloadSchema = z.object({
  roomCode: RoomCodeSchema,
  characterId: PveCharacterIdSchema,
});
export const PveSetPlanSlotPayloadSchema = z.object({
  roomCode: RoomCodeSchema,
  turnNumber: z.number().int().positive(),
  characterId: PveCharacterIdSchema,
  beat: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  action: z.object({
    actionId: PveActionIdSchema,
    target: PveActionTargetSchema.optional(),
  }).nullable(),
});
export const PveSetConfirmedPayloadSchema = z.object({
  roomCode: RoomCodeSchema,
  turnNumber: z.number().int().positive(),
  confirmed: z.boolean(),
});
export const PveTurnPayloadSchema = z.object({
  roomCode: RoomCodeSchema,
  turnNumber: z.number().int().positive(),
});
