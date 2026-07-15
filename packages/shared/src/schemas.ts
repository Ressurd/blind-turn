import { z } from "zod";

export const CreatePlayerInputSchema = z.object({
  id: z.string().trim().min(1),
  nickname: z.string().trim().min(1, "닉네임을 입력하세요.").max(20),
  seatNumber: z.number().int().min(1).max(6),
  characterId: z.enum(["DUELIST", "BERSERKER", "GUARDIAN", "TACTICIAN"]),
});

export const CreatePlayersSchema = z
  .array(CreatePlayerInputSchema)
  .min(2, "플레이어는 최소 2명이어야 합니다.")
  .max(6, "플레이어는 최대 6명까지 가능합니다.")
  .superRefine((players, context) => {
    const ids = new Set<string>();
    const seats = new Set<number>();
    players.forEach((player, index) => {
      if (ids.has(player.id)) {
        context.addIssue({
          code: "custom",
          message: "플레이어 ID가 중복되었습니다.",
          path: [index, "id"],
        });
      }
      if (seats.has(player.seatNumber)) {
        context.addIssue({
          code: "custom",
          message: "좌석 번호가 중복되었습니다.",
          path: [index, "seatNumber"],
        });
      }
      ids.add(player.id);
      seats.add(player.seatNumber);
    });
  });

export const ManualRollListSchema = z.array(
  z.number().int().min(1).max(10),
);
