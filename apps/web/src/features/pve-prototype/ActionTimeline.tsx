"use client";

import type {
  PveActionOrderEntry,
  PveBattleState,
  PveBeat,
  PveCombatEvent,
  PveResolvedActionTimelineEntry,
} from "@blind-turn/shared";
import { useEffect, useRef } from "react";
import styles from "./PvePrototype.module.css";

export type TimelineVisualStatus =
  | "PENDING"
  | "ACTIVE"
  | "COMPLETED"
  | "SKIPPED";

export type ActionTimelineViewItem = PveActionOrderEntry & {
  visualStatus: TimelineVisualStatus;
  isNext: boolean;
  skipReason?: string | undefined;
  resultSummary?: string | undefined;
  targetCharacterId?: PveResolvedActionTimelineEntry["targetCharacterId"];
  targetEnemyId?: PveResolvedActionTimelineEntry["targetEnemyId"];
  targetPosition?: PveResolvedActionTimelineEntry["targetPosition"];
};

export function buildPlanningTimelineItems(
  entries: readonly PveActionOrderEntry[],
): ActionTimelineViewItem[] {
  return entries.map((entry, index) => ({
    ...entry,
    visualStatus: "PENDING",
    isNext: index === 0,
  }));
}

export function buildPlaybackTimelineItems(
  entries: readonly PveResolvedActionTimelineEntry[],
  eventIndex: number,
): ActionTimelineViewItem[] {
  const items = entries.map<ActionTimelineViewItem>((entry) => {
    const visualStatus: TimelineVisualStatus = eventIndex < entry.startEventIndex
      ? "PENDING"
      : eventIndex <= entry.endEventIndex
        ? "ACTIVE"
        : entry.status;
    return {
      ...entry,
      visualStatus,
      isNext: false,
    };
  });
  const activeIndex = items.findIndex((entry) => entry.visualStatus === "ACTIVE");
  const nextIndex = items.findIndex((entry, index) =>
    index > activeIndex && entry.visualStatus === "PENDING"
  );
  if (nextIndex >= 0) items[nextIndex] = { ...items[nextIndex]!, isNext: true };
  return items;
}

function actorLabel(
  item: PveActionOrderEntry,
  characters: PveBattleState["characters"],
): string {
  return item.actorId === "BOSS" ? "BOSS" : characters[item.actorId].name;
}

export function timelineTargetLabel(
  item: ActionTimelineViewItem | null,
  characters: PveBattleState["characters"],
  bossName: string,
): string {
  if (!item) return "없음";
  if (item.targetCharacterId) return characters[item.targetCharacterId].name;
  if (item.targetEnemyId) return bossName;
  if (item.targetPosition) return `(${item.targetPosition.x}, ${item.targetPosition.y})`;
  if (item.target?.type === "ALLY") return characters[item.target.characterId].name;
  if (item.target?.type === "TILE") {
    return `(${item.target.position.x}, ${item.target.position.y})`;
  }
  if (item.actorId !== "BOSS" && item.phase === "ATTACK") return bossName;
  return "없음";
}

type ActionTimelineItemProps = {
  item: ActionTimelineViewItem;
  characters: PveBattleState["characters"];
};

export function ActionTimelineItem({ item, characters }: ActionTimelineItemProps) {
  const activeRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (item.visualStatus === "ACTIVE") {
      activeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, [item.visualStatus]);

  const statusText = item.visualStatus === "ACTIVE"
    ? "현재 행동"
    : item.visualStatus === "COMPLETED"
      ? "✓ 완료"
      : item.visualStatus === "SKIPPED"
        ? "✕ 취소"
        : item.isNext
          ? "다음"
          : "대기";

  return (
    <li
      className={`${styles.timelineItem} ${styles[`timeline${item.visualStatus}`]} ${item.isNext ? styles.timelineNext : ""}`}
      ref={activeRef}
      title={item.skipReason}
    >
      <span className={styles.timelineStatus}>{statusText}</span>
      <strong>{actorLabel(item, characters)}</strong>
      <b>{item.actionName}</b>
      {item.target?.type === "TILE" && (
        <small>대상 ({item.target.position.x}, {item.target.position.y})</small>
      )}
      {item.target?.type === "ALLY" && (
        <small>대상 {characters[item.target.characterId].name}</small>
      )}
    </li>
  );
}

type ActionTimelineProps = {
  beat: PveBeat;
  items: readonly ActionTimelineViewItem[];
  characters: PveBattleState["characters"];
  planning: boolean;
  onBeatChange: (beat: PveBeat) => void;
};

export function ActionTimeline({
  beat,
  items,
  characters,
  planning,
  onBeatChange,
}: ActionTimelineProps) {
  return (
    <section className={styles.timelineSequence} aria-label={`${beat}비트 행동 순서`}>
      <div className={styles.timelineHeading}>
        <strong>비트 {beat} / 3</strong>
        <div className={styles.timelineBeatTabs}>
          {([1, 2, 3] as const).map((candidate) => (
            <button
              aria-pressed={beat === candidate}
              disabled={!planning}
              key={candidate}
              onClick={() => onBeatChange(candidate)}
              type="button"
            >
              {candidate}
            </button>
          ))}
        </div>
        <span>{planning ? "예상 순서" : "실행 순서"}</span>
      </div>
      <ol className={styles.timelineScroller}>
        {items.map((item) => (
          <ActionTimelineItem characters={characters} item={item} key={item.id} />
        ))}
      </ol>
    </section>
  );
}

type CurrentActionBannerProps = {
  beat: PveBeat;
  activeItem: ActionTimelineViewItem | null;
  nextItem: ActionTimelineViewItem | null;
  currentEvent: PveCombatEvent | null;
  characters: PveBattleState["characters"];
  bossName: string;
  planning: boolean;
};

export function CurrentActionBanner({
  beat,
  activeItem,
  nextItem,
  currentEvent,
  characters,
  bossName,
  planning,
}: CurrentActionBannerProps) {
  const activeName = activeItem ? actorLabel(activeItem, characters) : "전투 준비";
  const nextName = nextItem
    ? `${actorLabel(nextItem, characters)} · ${nextItem.actionName}`
    : "없음";
  const target = timelineTargetLabel(activeItem, characters, bossName);
  return (
    <aside className={styles.currentActionBanner} aria-live="polite">
      <div><span>비트 {beat} / 3</span><em>다음: {nextName}</em></div>
      <strong>
        {planning ? "예상 순서" : "현재 행동"}: {activeName}
        {activeItem ? ` · ${activeItem.actionName}` : ""}
      </strong>
      <p>
        {planning
          ? "선제·방어 → 이동 → 지원 → 공격 → 보스 순서"
          : `대상: ${target} · ${currentEvent?.message ?? "첫 행동을 준비합니다."}`}
      </p>
    </aside>
  );
}

export function BeatTransitionOverlay({ beat }: { beat: PveBeat | null }) {
  if (!beat) return null;
  return <div className={styles.beatTransitionOverlay}>비트 {beat} 시작</div>;
}
