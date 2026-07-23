import { PVE_ACTIONS, PVE_BOSS_INTENTS, PVE_CHARACTER_ORDER } from "./fixtures";
import type {
  PveActionOrderEntry,
  PveBeat,
  PveBossPlan,
  PveCombatEvent,
  PvePlans,
  PveResolutionPhase,
  PveResolvedActionTimelineEntry,
} from "./types";

export const PVE_PLAYER_PHASE_ORDER: readonly PveResolutionPhase[] = [
  "PREPARE",
  "MOVE",
  "SUPPORT",
  "ATTACK",
];

function entryId(
  beat: PveBeat,
  actorId: PveActionOrderEntry["actorId"],
  segment: PveActionOrderEntry["segment"],
): string {
  return `beat-${beat}-${actorId.toLowerCase()}-${segment.toLowerCase()}`;
}

export function getPvePlannedActionOrder(
  plans: PvePlans,
  beat: PveBeat,
  bossPlan: PveBossPlan = PVE_BOSS_INTENTS,
): PveActionOrderEntry[] {
  const entries: PveActionOrderEntry[] = [];

  for (const characterId of PVE_CHARACTER_ORDER) {
    const action = plans[characterId][beat - 1];
    if (!action || action.actionId !== "PASS") continue;
    entries.push({
      id: entryId(beat, characterId, "PASS"),
      beat,
      actorId: characterId,
      actorType: "CHARACTER",
      actionId: action.actionId,
      actionName: PVE_ACTIONS.PASS.name,
      phase: "PREPARE",
      segment: "PASS",
    });
  }

  for (const phase of PVE_PLAYER_PHASE_ORDER) {
    for (const characterId of PVE_CHARACTER_ORDER) {
      const action = plans[characterId][beat - 1];
      if (!action || action.actionId === "PASS") continue;
      const definition = PVE_ACTIONS[action.actionId];
      if (definition.phase === phase) {
        entries.push({
          id: entryId(beat, characterId, "PRIMARY"),
          beat,
          actorId: characterId,
          actorType: "CHARACTER",
          actionId: action.actionId,
          actionName: definition.id === "ARCHER_RETREAT_SHOT"
            ? `${definition.name} · 이동`
            : definition.name,
          phase,
          segment: "PRIMARY",
          ...(action.target ? { target: action.target } : {}),
        });
      }
      if (phase === "ATTACK" && definition.id === "ARCHER_RETREAT_SHOT") {
        entries.push({
          id: entryId(beat, characterId, "RETREAT_ATTACK"),
          beat,
          actorId: characterId,
          actorType: "CHARACTER",
          actionId: action.actionId,
          actionName: `${definition.name} · 공격`,
          phase: "ATTACK",
          segment: "RETREAT_ATTACK",
        });
      }
    }
  }

  const bossIntent = bossPlan[beat - 1]!;
  entries.push({
    id: entryId(beat, "BOSS", "BOSS"),
    beat,
    actorId: "BOSS",
    actorType: "BOSS",
    bossIntentId: bossIntent.id,
    actionName: bossIntent.name,
    phase: "BOSS",
    segment: "BOSS",
  });

  return entries;
}

export function buildPveResolvedActionTimeline(
  events: readonly PveCombatEvent[],
  actionOrder: readonly PveActionOrderEntry[],
): PveResolvedActionTimelineEntry[] {
  return actionOrder.map((entry) => {
    const matching = events
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => event.timelineEntryId === entry.id);
    const first = matching[0];
    const last = matching.at(-1);
    if (!first || !last) {
      const fallbackIndex = Math.max(0, events.length - 1);
      return {
        ...entry,
        eventId: events[fallbackIndex]?.id ?? entry.id,
        startEventIndex: fallbackIndex,
        endEventIndex: fallbackIndex,
        status: "SKIPPED",
        skipReason: "전투가 먼저 종료되어 행동하지 못했습니다.",
        resultSummary: "전투 종료로 행동이 취소되었습니다.",
      };
    }

    const failed = matching.find(({ event }) => event.type === "ACTION_FAILED");
    const targetCharacterId = matching.find(({ event }) => event.targetCharacterId)
      ?.event.targetCharacterId;
    const targetEnemyId = matching.find(({ event }) => event.targetEnemyId)
      ?.event.targetEnemyId;
    const targetPosition = entry.target?.type === "TILE"
      ? entry.target.position
      : matching.find(({ event }) => event.selectedCenter || event.to)?.event.selectedCenter
        ?? matching.find(({ event }) => event.to)?.event.to;

    return {
      ...entry,
      eventId: first.event.id,
      startEventIndex: first.index,
      endEventIndex: last.index,
      status: failed ? "SKIPPED" : "COMPLETED",
      ...(failed
        ? { skipReason: failed.event.skipReason ?? failed.event.message }
        : {}),
      resultSummary: last.event.message,
      ...(targetCharacterId ? { targetCharacterId } : {}),
      ...(targetEnemyId ? { targetEnemyId } : {}),
      ...(targetPosition ? { targetPosition } : {}),
    };
  });
}
