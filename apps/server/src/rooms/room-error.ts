import type { RoomErrorCode, SocketError } from "@blind-turn/shared";

const ERROR_MESSAGES: Record<RoomErrorCode, string> = {
  ROOM_NOT_FOUND: "방을 찾을 수 없습니다.",
  ROOM_SESSION_EXPIRED: "서버가 재시작되어 기존 방을 복구할 수 없습니다. 새 방에서 다시 시작해 주세요.",
  ROOM_FULL: "방이 가득 찼습니다.",
  ROOM_CODE_GENERATION_FAILED: "방 코드를 만들지 못했습니다.",
  GAME_ALREADY_STARTED: "이미 게임이 시작되었습니다.",
  NICKNAME_ALREADY_USED: "이미 사용 중인 닉네임입니다.",
  INVALID_NICKNAME: "닉네임은 공백 제외 1~12자로 입력해 주세요.",
  INVALID_PAYLOAD: "요청 형식이 올바르지 않습니다.",
  NOT_ROOM_HOST: "방장만 실행할 수 있습니다.",
  NOT_ALL_PLAYERS_READY: "모든 플레이어가 접속하고 준비해야 합니다.",
  NOT_ENOUGH_PLAYERS: "게임 시작에는 최소 2명이 필요합니다.",
  CHARACTER_NOT_SELECTED: "캐릭터를 먼저 선택해 주세요.",
  PLAYER_NOT_FOUND: "플레이어를 찾을 수 없습니다.",
  INVALID_RECONNECT_TOKEN: "재접속 정보가 올바르지 않습니다.",
  SOCKET_NOT_OWNER: "현재 연결에서 실행할 수 없는 요청입니다.",
  INVALID_GAME_PHASE: "현재 게임 단계에서는 실행할 수 없습니다.",
  PLAYER_DEAD: "사망한 플레이어는 행동할 수 없습니다.",
  CARD_NOT_IN_HAND: "현재 손패에 없는 카드입니다.",
  CARD_ALREADY_QUEUED: "이미 큐에 넣은 카드입니다.",
  MAX_QUEUED_CARDS_EXCEEDED: "한 라운드에는 최대 3장까지 사용할 수 있습니다.",
  INVALID_QUEUE_ORDER: "카드 순서가 올바르지 않습니다.",
  INVALID_CARD_TARGET: "카드 대상을 확인해 주세요.",
  INVALID_ADDITIONAL_SELECTION: "카드의 추가 선택을 확인해 주세요.",
  ROUND_ALREADY_CONFIRMED: "이미 이번 라운드를 확정했습니다.",
  ROUND_NUMBER_MISMATCH: "현재 라운드와 요청 라운드가 일치하지 않습니다.",
  REWARD_OPTION_NOT_FOUND: "선택할 수 없는 보상 카드입니다.",
  INVALID_DECK_REMOVAL: "제거할 수 없는 카드입니다.",
  ATTACK_CARD_REQUIRED: "덱에는 공격 카드가 최소 1장 남아야 합니다.",
  INITIAL_HAND_SELECTION_REQUIRED: "전략가의 시작 손패 3장을 선택해 주세요.",
  CHAT_EMPTY: "빈 메시지는 보낼 수 없습니다.",
  CHAT_MESSAGE_TOO_LONG: "채팅은 100자까지 입력할 수 있습니다.",
  CHAT_RATE_LIMITED: "채팅을 너무 빠르게 보내고 있습니다.",
  CHAT_DEAD_PLAYER: "사망한 플레이어는 채팅을 보낼 수 없습니다.",
  GAME_ENGINE_FAILURE: "전투 판정 중 오류가 발생해 게임을 종료했습니다.",
  INTERNAL_SERVER_ERROR: "서버에서 예상하지 못한 오류가 발생했습니다.",
};

const NON_RECOVERABLE_ERRORS = new Set<RoomErrorCode>([
  "ROOM_SESSION_EXPIRED",
  "INVALID_RECONNECT_TOKEN",
  "PLAYER_NOT_FOUND",
]);

export class RoomError extends Error {
  constructor(
    public readonly code: RoomErrorCode,
    message = ERROR_MESSAGES[code],
  ) {
    super(message);
    this.name = "RoomError";
  }

  toSocketError(): SocketError {
    return {
      code: this.code,
      message: this.message,
      recoverable: !NON_RECOVERABLE_ERRORS.has(this.code),
    };
  }
}

export function toRoomError(error: unknown): RoomError {
  return error instanceof RoomError
    ? error
    : new RoomError("INTERNAL_SERVER_ERROR");
}
