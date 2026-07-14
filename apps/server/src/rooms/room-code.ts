import { ROOM_CODE_LENGTH } from "@blind-turn/shared";

export const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function createRoomCode(random = Math.random): string {
  return Array.from({ length: ROOM_CODE_LENGTH }, () => {
    const index = Math.floor(random() * ROOM_CODE_ALPHABET.length);
    return ROOM_CODE_ALPHABET[index]!;
  }).join("");
}
