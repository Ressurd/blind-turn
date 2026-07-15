import {
  ConfirmRoundPayloadSchema,
  EventsFinishedPayloadSchema,
  InitialHandSelectionPayloadSchema,
  QueueCardPayloadSchema,
  RemoveQueuedCardPayloadSchema,
  ReorderQueuedCardsPayloadSchema,
  RoomCodePayloadSchema,
  SelectDeckRemovalPayloadSchema,
  SelectRewardPayloadSchema,
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
        ...(parsed.targetPlayerId ? { targetPlayerId: parsed.targetPlayerId } : {}),
        additionalSelection: parsed.additionalSelection ?? null,
      });
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

  socket.on("game:select-reward", (payload, ack) => {
    runSocketRequest(socket, "game", ack, () => {
      const parsed = parsePayload(SelectRewardPayloadSchema, payload);
      const session = requireSocketSession(socket, parsed.roomCode);
      roomManager.selectReward(parsed.roomCode, session.playerId, socket.id, parsed.cardId);
      return { accepted: true as const };
    }, logger);
  });

  socket.on("game:select-deck-removal", (payload, ack) => {
    runSocketRequest(socket, "game", ack, () => {
      const parsed = parsePayload(SelectDeckRemovalPayloadSchema, payload);
      const session = requireSocketSession(socket, parsed.roomCode);
      roomManager.selectDeckRemoval(
        parsed.roomCode,
        session.playerId,
        socket.id,
        parsed.cardInstanceId,
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
