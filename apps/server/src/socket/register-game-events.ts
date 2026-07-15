import {
  ConfirmRoundPayloadSchema,
  EventsFinishedPayloadSchema,
  InitialHandSelectionPayloadSchema,
  MoveQueuedCardPayloadSchema,
  QueueCardPayloadSchema,
  RemoveQueuedCardPayloadSchema,
  ReorderQueuedCardsPayloadSchema,
  RoomCodePayloadSchema,
  UpdateDeckRemovalPayloadSchema,
  UpdateRewardSelectionPayloadSchema,
} from "@blind-turn/shared";
import type { AppLogger } from "../logging/logger";
import type { RoomManager } from "../rooms/room-manager";
import { parsePayload, runSocketRequest } from "./socket-handler";
import { requireSocketSession, type GameSocket } from "./socket-session";

export function registerGameEvents(
  socket: GameSocket,
  roomManager: RoomManager,
  logger: AppLogger,
): void {
  socket.on("game:select-initial-hand", (payload, ack) => {
    runSocketRequest(socket, "game", ack, () => {
      const parsed = parsePayload(InitialHandSelectionPayloadSchema, payload);
      const session = requireSocketSession(socket, parsed.roomCode);
      roomManager.selectInitialHand(
        parsed.roomCode,
        session.playerId,
        socket.id,
        parsed.selectedInstanceIds,
      );
      return { accepted: true as const };
    }, logger);
  });

  socket.on("game:queue-card", (payload, ack) => {
    runSocketRequest(socket, "game", ack, () => {
      const parsed = parsePayload(QueueCardPayloadSchema, payload);
      const session = requireSocketSession(socket, parsed.roomCode);
      roomManager.queueCard(parsed.roomCode, session.playerId, socket.id, parsed.roundNumber, {
        cardInstanceId: parsed.cardInstanceId,
        ...(parsed.order === undefined ? {} : { order: parsed.order }),
        ...(parsed.targetPlayerId ? { targetPlayerId: parsed.targetPlayerId } : {}),
        additionalSelection: parsed.additionalSelection ?? null,
      });
      return { accepted: true as const };
    }, logger);
  });

  socket.on("game:move-queued-card", (payload, ack) => {
    runSocketRequest(socket, "game", ack, () => {
      const parsed = parsePayload(MoveQueuedCardPayloadSchema, payload);
      const session = requireSocketSession(socket, parsed.roomCode);
      roomManager.moveQueuedCard(
        parsed.roomCode,
        session.playerId,
        socket.id,
        parsed.roundNumber,
        parsed.cardInstanceId,
        parsed.order,
      );
      return { accepted: true as const };
    }, logger);
  });

  socket.on("game:remove-queued-card", (payload, ack) => {
    runSocketRequest(socket, "game", ack, () => {
      const parsed = parsePayload(RemoveQueuedCardPayloadSchema, payload);
      const session = requireSocketSession(socket, parsed.roomCode);
      roomManager.removeQueuedCard(
        parsed.roomCode,
        session.playerId,
        socket.id,
        parsed.roundNumber,
        parsed.cardInstanceId,
      );
      return { accepted: true as const };
    }, logger);
  });

  socket.on("game:reorder-queued-cards", (payload, ack) => {
    runSocketRequest(socket, "game", ack, () => {
      const parsed = parsePayload(ReorderQueuedCardsPayloadSchema, payload);
      const session = requireSocketSession(socket, parsed.roomCode);
      roomManager.reorderQueuedCards(
        parsed.roomCode,
        session.playerId,
        socket.id,
        parsed.roundNumber,
        parsed.orderedInstanceIds,
      );
      return { accepted: true as const };
    }, logger);
  });

  socket.on("game:confirm-round", (payload, ack) => {
    runSocketRequest(socket, "game", ack, () => {
      const parsed = parsePayload(ConfirmRoundPayloadSchema, payload);
      const session = requireSocketSession(socket, parsed.roomCode);
      roomManager.confirmRound(
        parsed.roomCode,
        session.playerId,
        socket.id,
        parsed.roundNumber,
      );
      return { accepted: true as const };
    }, logger);
  });

  socket.on("game:events-finished", (payload, ack) => {
    runSocketRequest(socket, "game", ack, () => {
      const parsed = parsePayload(EventsFinishedPayloadSchema, payload);
      const session = requireSocketSession(socket, parsed.roomCode);
      roomManager.eventsFinished(
        parsed.roomCode,
        session.playerId,
        socket.id,
        parsed.roundNumber,
      );
      return { accepted: true as const };
    }, logger);
  });

  socket.on("game:update-reward-selection", (payload, ack) => {
    runSocketRequest(socket, "game", ack, () => {
      const parsed = parsePayload(UpdateRewardSelectionPayloadSchema, payload);
      const session = requireSocketSession(socket, parsed.roomCode);
      roomManager.updateRewardSelection(
        parsed.roomCode,
        session.playerId,
        socket.id,
        parsed.selectedCardIds,
      );
      return { accepted: true as const };
    }, logger);
  });

  socket.on("game:confirm-reward", (payload, ack) => {
    runSocketRequest(socket, "game", ack, () => {
      const parsed = parsePayload(RoomCodePayloadSchema, payload);
      const session = requireSocketSession(socket, parsed.roomCode);
      roomManager.confirmReward(parsed.roomCode, session.playerId, socket.id);
      return { accepted: true as const };
    }, logger);
  });

  socket.on("game:update-deck-removal", (payload, ack) => {
    runSocketRequest(socket, "game", ack, () => {
      const parsed = parsePayload(UpdateDeckRemovalPayloadSchema, payload);
      const session = requireSocketSession(socket, parsed.roomCode);
      roomManager.updateDeckRemoval(
        parsed.roomCode,
        session.playerId,
        socket.id,
        parsed.selectedInstanceIds,
      );
      return { accepted: true as const };
    }, logger);
  });

  socket.on("game:confirm-deck-removal", (payload, ack) => {
    runSocketRequest(socket, "game", ack, () => {
      const parsed = parsePayload(RoomCodePayloadSchema, payload);
      const session = requireSocketSession(socket, parsed.roomCode);
      roomManager.confirmDeckRemoval(
        parsed.roomCode,
        session.playerId,
        socket.id,
      );
      return { accepted: true as const };
    }, logger);
  });

  socket.on("game:request-rematch", (payload, ack) => {
    runSocketRequest(socket, "game", ack, () => {
      const parsed = parsePayload(RoomCodePayloadSchema, payload);
      const session = requireSocketSession(socket, parsed.roomCode);
      roomManager.requestRematch(parsed.roomCode, session.playerId, socket.id);
      return { reset: true as const };
    }, logger);
  });
}
