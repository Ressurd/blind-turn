import { z } from "zod";

export const NicknameSchema = z
  .string()
  .trim()
  .min(1, "닉네임을 입력하세요.")
  .max(12, "닉네임은 12자 이하여야 합니다.");

export const RoomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/, "방 코드 형식이 올바르지 않습니다.");

export const SocketPlayerActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ATTACK"), targetPlayerId: z.string().min(1) }),
  z.object({ type: z.literal("DEFEND") }),
  z.object({ type: z.literal("EVADE") }),
  z.object({ type: z.literal("COUNTER"), targetPlayerId: z.string().min(1) }),
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

export const SetReadyPayloadSchema = z.object({
  roomCode: RoomCodeSchema,
  ready: z.boolean(),
});

export const SubmitActionPayloadSchema = z.object({
  roomCode: RoomCodeSchema,
  turnNumber: z.number().int().positive(),
  action: SocketPlayerActionSchema,
});

export const EventsFinishedPayloadSchema = z.object({
  roomCode: RoomCodeSchema,
  turnNumber: z.number().int().positive(),
});
