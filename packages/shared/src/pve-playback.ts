import type {
  PveCombatEvent,
  PveResolvedActionTimelineEntry,
  PveTurnResolution,
} from "@blind-turn/game-engine";

export const PVE_PLAYBACK_TIMINGS = {
  bootstrapMs: 100,
  beatTransitionMs: 800,
  beatFinishedMs: 250,
  turnFinishedMs: 900,
  defaultSystemEventMs: 400,
  reducedMotionBootstrapMs: 30,
  reducedMotionEventMs: 70,
  normalActionMs: 3_500,
  failedActionMs: 3_000,
  passActionMs: 2_000,
  bossActionMs: 4_250,
  normalActionLeadMs: 1_150,
  failedActionLeadMs: 1_000,
  bossActionLeadMs: 1_800,
  resultHoldMs: 650,
  timeoutBufferMs: 10_000,
  minimumTimeoutMs: 45_000,
  maximumTimeoutMs: 120_000,
} as const;

export const PVE_PLAYBACK_TIMEOUT_MS = PVE_PLAYBACK_TIMINGS.minimumTimeoutMs;

const SYSTEM_EVENT_DURATIONS: Partial<Record<PveCombatEvent["type"], number>> = {
  BEAT_STARTED: PVE_PLAYBACK_TIMINGS.beatTransitionMs,
  BEAT_FINISHED: PVE_PLAYBACK_TIMINGS.beatFinishedMs,
  TURN_FINISHED: PVE_PLAYBACK_TIMINGS.turnFinishedMs,
};

export function getPveTimelineEntryPlaybackDuration(
  entry: PveResolvedActionTimelineEntry,
): number {
  if (entry.status === "SKIPPED") return PVE_PLAYBACK_TIMINGS.failedActionMs;
  if (entry.actionId === "PASS") return PVE_PLAYBACK_TIMINGS.passActionMs;
  if (entry.actorType === "BOSS") return PVE_PLAYBACK_TIMINGS.bossActionMs;
  return PVE_PLAYBACK_TIMINGS.normalActionMs;
}

function getEntryLeadDuration(entry: PveResolvedActionTimelineEntry): number {
  if (entry.status === "SKIPPED") return PVE_PLAYBACK_TIMINGS.failedActionLeadMs;
  if (entry.actorType === "BOSS") return PVE_PLAYBACK_TIMINGS.bossActionLeadMs;
  return PVE_PLAYBACK_TIMINGS.normalActionLeadMs;
}

function getEntryEventDuration(
  entry: PveResolvedActionTimelineEntry,
  eventIndex: number,
): number {
  const total = getPveTimelineEntryPlaybackDuration(entry);
  const eventCount = entry.endEventIndex - entry.startEventIndex + 1;
  if (eventCount <= 1) return total;

  const offset = eventIndex - entry.startEventIndex;
  const lead = Math.min(
    getEntryLeadDuration(entry),
    total - PVE_PLAYBACK_TIMINGS.resultHoldMs,
  );
  if (offset === 0) return lead;

  const intermediateCount = eventCount - 2;
  if (intermediateCount <= 0) return total - lead;

  const intermediateDuration = Math.floor(
    (total - lead - PVE_PLAYBACK_TIMINGS.resultHoldMs) / intermediateCount,
  );
  if (offset < eventCount - 1) return intermediateDuration;
  return total - lead - (intermediateDuration * intermediateCount);
}

export function getPvePlaybackEventDuration(
  resolution: PveTurnResolution,
  eventIndex: number,
  reducedMotion = false,
): number {
  if (eventIndex < 0) {
    return reducedMotion
      ? PVE_PLAYBACK_TIMINGS.reducedMotionBootstrapMs
      : PVE_PLAYBACK_TIMINGS.bootstrapMs;
  }
  const event = resolution.events[eventIndex];
  if (!event) return 0;
  if (reducedMotion) return PVE_PLAYBACK_TIMINGS.reducedMotionEventMs;

  const timelineEntry = event.timelineEntryId
    ? resolution.timeline.find((entry) => entry.id === event.timelineEntryId)
    : undefined;
  if (timelineEntry) return getEntryEventDuration(timelineEntry, eventIndex);

  return SYSTEM_EVENT_DURATIONS[event.type]
    ?? PVE_PLAYBACK_TIMINGS.defaultSystemEventMs;
}

export function getPveTurnPlaybackDuration(resolution: PveTurnResolution): number {
  return resolution.events.reduce<number>(
    (total, _event, eventIndex) =>
      total + getPvePlaybackEventDuration(resolution, eventIndex),
    PVE_PLAYBACK_TIMINGS.bootstrapMs,
  );
}

export function getPveTurnPlaybackTimeoutMs(resolution: PveTurnResolution): number {
  const expectedDuration = getPveTurnPlaybackDuration(resolution);
  return Math.min(
    PVE_PLAYBACK_TIMINGS.maximumTimeoutMs,
    Math.max(
      PVE_PLAYBACK_TIMINGS.minimumTimeoutMs,
      expectedDuration + PVE_PLAYBACK_TIMINGS.timeoutBufferMs,
    ),
  );
}
