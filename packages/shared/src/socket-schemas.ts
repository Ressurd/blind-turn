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
export const InitialHandSelectionPayloadSchema = z.object({
  roomCode: RoomCodeSchema,
  selectedInstanceIds: z.array(z.string().min(1)).length(3),
});

const AdditionalSelectionSchema = z.union([
  z.object({ discardCardInstanceId: z.string().min(1) }),
  z.object({ handCardInstanceIds: z.array(z.string().min(1)).max(2) }),
  z.object({ returnCardInstanceId: z.string().min(1) }),
  z.null(),
]);

export const QueueCardPayloadSchema = z.object({
  roomCode: RoomCodeSchema,
  roundNumber: z.number().int().positive(),
  cardInstanceId: z.string().min(1),
  targetPlayerId: z.string().min(1).optional(),
  additionalSelection: AdditionalSelectionSchema.optional(),
});
export const RemoveQueuedCardPayloadSchema = z.object({
  roomCode: RoomCodeSchema,
  roundNumber: z.number().int().positive(),
  cardInstanceId: z.string().min(1),
});
export const ReorderQueuedCardsPayloadSchema = z.object({
  roomCode: RoomCodeSchema,
  roundNumber: z.number().int().positive(),
  orderedInstanceIds: z.array(z.string().min(1)).max(3),
});
export const ConfirmRoundPayloadSchema = z.object({
  roomCode: RoomCodeSchema,
  roundNumber: z.number().int().positive(),
});
export const EventsFinishedPayloadSchema = z.object({
  roomCode: RoomCodeSchema,
  roundNumber: z.number().int().positive(),
});
export const SelectRewardPayloadSchema = z.object({
  roomCode: RoomCodeSchema,
  cardId: z.string().min(1),
});
export const SelectDeckRemovalPayloadSchema = z.object({
  roomCode: RoomCodeSchema,
  cardInstanceId: z.string().min(1),
});
export const ChatSendPayloadSchema = z.object({
  roomCode: RoomCodeSchema,
  message: z.string(),
});
