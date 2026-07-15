import type { PlayerGameView, PrivateCardView } from "@blind-turn/shared";

export function getTargetActionCandidates(
  view: PlayerGameView,
  targetPlayerId: string,
): PrivateCardView[] {
  const target = view.players.find((player) => player.playerId === targetPlayerId);
  if (
    view.phase !== "SELECTING_CARDS"
    || !target?.alive
    || view.myConfirmed
    || view.myQueuedCards.length >= 3
  ) return [];
  const queuedIds = new Set(view.myQueuedCards.map((queued) => queued.cardInstanceId));
  const additionallyReservedIds = new Set(view.myQueuedCards.flatMap((queued) => {
    const selection = queued.additionalSelection;
    if (!selection) return [];
    if ("handCardInstanceIds" in selection) return selection.handCardInstanceIds;
    if ("returnCardInstanceId" in selection) return [selection.returnCardInstanceId];
    return [];
  }));
  const selectingSelf = targetPlayerId === view.selfPlayerId;
  return view.myHand.filter((card) => {
    if (queuedIds.has(card.instanceId) || additionallyReservedIds.has(card.instanceId)) return false;
    if (selectingSelf) {
      if (card.definition.targetType === "ENEMY") return false;
    } else if (card.definition.targetType !== "ENEMY") return false;
    if (card.cardId === "TACTICIAN_RECYCLE" && view.myDiscardPile.length === 0) return false;
    return true;
  });
}

export function getReservationLabels(
  view: PlayerGameView,
): Record<string, string[]> {
  const names: Record<string, string[]> = {};
  for (const queued of view.myQueuedCards) {
    const card = view.myHand.find((entry) => entry.instanceId === queued.cardInstanceId);
    if (!card) continue;
    const ownerId = queued.targetPlayerId ?? view.selfPlayerId;
    names[ownerId] = [...(names[ownerId] ?? []), `${queued.order + 1}단계 · ${card.definition.name}`];
  }
  return names;
}
