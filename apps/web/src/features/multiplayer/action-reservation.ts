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
  ) return [];
  const selectingSelf = targetPlayerId === view.selfPlayerId;
  return view.myHand.filter((card) => {
    if (selectingSelf) {
      if (card.definition.targetType === "ENEMY") return false;
    } else if (card.definition.targetType !== "ENEMY") return false;
    if (card.cardId === "TACTICIAN_RECYCLE" && view.myDiscardPile.length === 0) {
      return false;
    }
    return true;
  });
}

export function getReservationLabels(
  view: PlayerGameView,
): Record<string, string[]> {
  const selected = view.mySelectedAction;
  if (!selected) return {};
  const card = view.myHand.find(
    (entry) => entry.instanceId === selected.cardInstanceId,
  );
  if (!card) return {};
  const ownerId = selected.targetPlayerId ?? view.selfPlayerId;
  return { [ownerId]: [`선택 · ${card.definition.name}`] };
}
