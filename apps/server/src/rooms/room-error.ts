import type { RoomErrorCode, SocketError } from "@blind-turn/shared";

const ERROR_MESSAGES: Record<RoomErrorCode, string> = {
  ROOM_NOT_FOUND: "방을 찾을 수 없습니다.",
  ROOM_SESSION_EXPIRED:
    "서버가 재시작되어 기존 게임을 복구할 수 없습니다. 새 방을 만들어 다시 시작해 주세요.",
  ROOM_FULL: "방이 가득 찼습니다.",
  ROOM_CODE_GENERATION_FAILED: "방 코드를 만들지 못했습니다.",
  GAME_ALREADY_STARTED: "이미 게임이 시작되었습니다.",
  NICKNAME_ALREADY_USED: "이미 사용 중인 닉네임입니다.",
  INVALID_NICKNAME: "닉네임은 공백 제외 1~12자로 입력하세요.",
  INVALID_PAYLOAD: "요청 형식이 올바르지 않습니다.",
  NOT_ROOM_HOST: "방장만 실행할 수 있습니다.",
  NOT_ALL_PLAYERS_READY: "모든 플레이어가 준비되어야 합니다.",
  NOT_ENOUGH_PLAYERS: "게임 시작에는 최소 2명이 필요합니다.",
  PLAYER_NOT_FOUND: "플레이어를 찾을 수 없습니다.",
  INVALID_RECONNECT_TOKEN: "재접속 정보가 올바르지 않습니다.",
  SOCKET_NOT_OWNER: "현재 연결에서 실행할 수 없는 요청입니다.",
  INVALID_GAME_PHASE: "현재 게임 단계에서는 실행할 수 없습니다.",
  PLAYER_DEAD: "사망한 플레이어는 행동할 수 없습니다.",
  ACTION_ALREADY_SUBMITTED: "이미 행동을 제출했습니다.",
  INVALID_ACTION: "선택한 행동이 올바르지 않습니다.",
  INVALID_TARGET: "행동 대상을 확인하세요.",
  TURN_NUMBER_MISMATCH: "현재 턴과 요청한 턴이 일치하지 않습니다.",
  GAME_ENGINE_FAILURE:
    "턴 판정 중 오류가 발생해 게임을 종료했습니다. 방장은 재경기를 시작할 수 있습니다.",
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
