"use client";

import {
  createEmptyPvePlans,
  createInitialPveBattleState,
  getPveAttackGeometry,
  getPveActionsForCharacter,
  getPvePlannedActionOrder,
  isPvePlanComplete,
  PVE_ACTIONS,
  PVE_BOARD_HEIGHT,
  PVE_BOARD_WIDTH,
  PVE_BOSS_INTENTS,
  PVE_CHARACTER_ORDER,
  projectPveAttackPlanningPositions,
  resolvePveTurn,
  selectPveTrackingTarget,
  validatePvePlannedAction,
  type PveActionId,
  type PveActionTarget,
  type PveAttackGeometry,
  type PveBattleState,
  type PveBeat,
  type PveCharacterId,
  type PveCombatEvent,
  type PvePlans,
  type PvePosition,
} from "@blind-turn/shared";
import Link from "next/link";
import { type CSSProperties, useMemo, useState } from "react";
import styles from "./PvePrototype.module.css";
import {
  ActionTimeline,
  BeatTransitionOverlay,
  buildPlanningTimelineItems,
  buildPlaybackTimelineItems,
  CurrentActionBanner,
} from "./ActionTimeline";
import { usePvePlayback } from "./usePvePlayback";

const BEATS: readonly PveBeat[] = [1, 2, 3];
const BEAT_MARKERS = ["①", "②", "③"] as const;
const PHASE_LABELS: Record<PveCombatEvent["phase"], string> = {
  PREPARE: "선제·방어",
  MOVE: "이동",
  SUPPORT: "지원",
  ATTACK: "공격",
  BOSS: "보스",
  STATUS: "상태 확인",
};

function clonePlans(plans: PvePlans): PvePlans {
  return {
    WARRIOR: [...plans.WARRIOR],
    ARCHER: [...plans.ARCHER],
    MAGE: [...plans.MAGE],
    PRIEST: [...plans.PRIEST],
  };
}

function targetLabel(target: PveActionTarget | undefined): string {
  if (!target) return "";
  if (target.type === "ALLY") return ` → ${target.characterId}`;
  return ` → (${target.position.x},${target.position.y})`;
}

function summaryTargetLabel(
  target: PveActionTarget | undefined,
  characters: PveBattleState["characters"],
): string {
  if (!target) return "";
  if (target.type === "ALLY") return `→ ${characters[target.characterId].name}`;
  return `→ (${target.position.x}, ${target.position.y})`;
}

function tileKey(position: PvePosition): string {
  return `${position.x}:${position.y}`;
}

function samePosition(left: PvePosition, right: PvePosition): boolean {
  return left.x === right.x && left.y === right.y;
}

function isCharacterId(value: unknown): value is PveCharacterId {
  return typeof value === "string"
    && PVE_CHARACTER_ORDER.includes(value as PveCharacterId);
}

type PreviewSlot = {
  characterId: PveCharacterId;
  beat: PveBeat;
};

function actionCount(plans: PvePlans): number {
  return PVE_CHARACTER_ORDER.reduce(
    (total, id) => total + plans[id].filter(Boolean).length,
    0,
  );
}

export function PvePrototype() {
  const [initialState, setInitialState] = useState<PveBattleState>(() =>
    createInitialPveBattleState()
  );
  const playback = usePvePlayback(initialState);
  const displayState = playback.displayState;
  const [plans, setPlans] = useState<PvePlans>(() => createEmptyPvePlans());
  const [selectedId, setSelectedId] = useState<PveCharacterId>("WARRIOR");
  const [selectedBeat, setSelectedBeat] = useState<PveBeat>(1);
  const [timelineBeat, setTimelineBeat] = useState<PveBeat>(1);
  const [pendingActionId, setPendingActionId] = useState<PveActionId | null>(null);
  const [previewSlot, setPreviewSlot] = useState<PreviewSlot>({
    characterId: "WARRIOR",
    beat: 1,
  });
  const [planningMessage, setPlanningMessage] = useState(
    "행동 슬롯을 고른 뒤 카드를 선택하세요.",
  );
  const locked = playback.resolution !== null;
  const complete = isPvePlanComplete(plans);
  const currentEvent = playback.currentEvent;
  const currentBeat = currentEvent?.beat ?? null;
  const trackingTargetId = playback.resolution?.trackingTargetId
    ?? selectPveTrackingTarget(initialState);
  const selectedCharacter = displayState.characters[selectedId];
  const actions = getPveActionsForCharacter(selectedId);
  const pendingDefinition = pendingActionId ? PVE_ACTIONS[pendingActionId] : null;
  const previewCharacterId = pendingActionId ? selectedId : previewSlot.characterId;
  const previewBeat = pendingActionId ? selectedBeat : previewSlot.beat;
  const previewPlannedAction = plans[previewCharacterId][previewBeat - 1];
  const previewActionId = pendingActionId ?? previewPlannedAction?.actionId ?? null;
  const previewDefinition = previewActionId ? PVE_ACTIONS[previewActionId] : null;

  const previewGeometry = useMemo<PveAttackGeometry | null>(() => {
    const characterId = previewCharacterId;
    const beat = previewBeat;
    const planned = previewPlannedAction;
    const actionId = previewActionId;
    if (!actionId || !PVE_ACTIONS[actionId].attackPattern) return null;

    const previewPlans = pendingActionId ? clonePlans(plans) : plans;
    if (pendingActionId) {
      previewPlans[characterId][beat - 1] = { actionId: pendingActionId };
    }
    const positions = projectPveAttackPlanningPositions(
      initialState,
      previewPlans,
      beat,
    );
    const planningState: PveBattleState = {
      characters: {
        WARRIOR: { ...initialState.characters.WARRIOR, position: { ...positions.WARRIOR } },
        ARCHER: { ...initialState.characters.ARCHER, position: { ...positions.ARCHER } },
        MAGE: { ...initialState.characters.MAGE, position: { ...positions.MAGE } },
        PRIEST: { ...initialState.characters.PRIEST, position: { ...positions.PRIEST } },
      },
      boss: {
        ...initialState.boss,
        occupiedTiles: initialState.boss.occupiedTiles.map((position) => ({ ...position })),
      },
      result: initialState.result,
    };
    const selectedCenter = !pendingActionId && planned?.target?.type === "TILE"
      ? planned.target.position
      : undefined;
    return getPveAttackGeometry(
      planningState,
      characterId,
      actionId,
      selectedCenter,
    );
  }, [
    initialState,
    pendingActionId,
    plans,
    previewActionId,
    previewBeat,
    previewCharacterId,
    previewPlannedAction,
  ]);

  const visibleUseRange = locked ? [] : previewGeometry?.useRange ?? [];
  const visibleEffectArea = currentEvent?.effectArea
    ?? (!locked ? previewGeometry?.effectArea ?? [] : []);
  const visibleCenter = currentEvent?.selectedCenter
    ?? (!locked ? previewGeometry?.selectedCenter ?? null : null);

  const tiles = useMemo(() => {
    const result: PvePosition[] = [];
    for (let y = 0; y < PVE_BOARD_HEIGHT; y += 1) {
      for (let x = 0; x < PVE_BOARD_WIDTH; x += 1) result.push({ x, y });
    }
    return result;
  }, []);

  function chooseNextSlot(nextPlans: PvePlans): void {
    const nextIndex = nextPlans[selectedId].findIndex((slot) => slot === null);
    if (nextIndex >= 0) setSelectedBeat((nextIndex + 1) as PveBeat);
  }

  function commitAction(
    actionId: PveActionId,
    target?: PveActionTarget,
  ): void {
    const action = target ? { actionId, target } : { actionId };
    const validation = validatePvePlannedAction(
      initialState,
      plans,
      selectedId,
      selectedBeat,
      action,
    );
    if (!validation.valid) {
      setPlanningMessage(validation.reason);
      return;
    }
    const next = clonePlans(plans);
    next[selectedId][selectedBeat - 1] = action;
    setPlans(next);
    setPreviewSlot({ characterId: selectedId, beat: selectedBeat });
    setTimelineBeat(selectedBeat);
    setPendingActionId(null);
    setPlanningMessage(
      `${selectedCharacter.name}의 ${selectedBeat}번 슬롯에 ${PVE_ACTIONS[actionId].name}을 배치했습니다.`,
    );
    chooseNextSlot(next);
  }

  function selectAction(actionId: PveActionId): void {
    if (locked) return;
    const definition = PVE_ACTIONS[actionId];
    setPreviewSlot({ characterId: selectedId, beat: selectedBeat });
    if (definition.targetType === "NONE") {
      commitAction(actionId);
      return;
    }
    setPendingActionId(actionId);
    setPlanningMessage(
      definition.targetType === "TILE"
        ? definition.phase === "ATTACK"
          ? `${definition.name}: 강조된 범위에서 공격 중심 타일을 선택하세요.`
          : `${definition.name}: 전장에서 이동할 타일을 선택하세요.`
        : `${definition.name}: 전장에서 아군 토큰을 선택하세요.`,
    );
  }

  function selectTile(position: PvePosition): void {
    if (!pendingDefinition || pendingDefinition.targetType !== "TILE") return;
    commitAction(pendingDefinition.id, { type: "TILE", position });
  }

  function selectCharacter(characterId: PveCharacterId): void {
    if (pendingDefinition?.targetType === "ALLY" && !locked) {
      commitAction(pendingDefinition.id, { type: "ALLY", characterId });
      return;
    }
    setSelectedId(characterId);
    setPendingActionId(null);
    const firstEmpty = plans[characterId].findIndex((slot) => slot === null);
    const nextBeat = firstEmpty >= 0 ? (firstEmpty + 1) as PveBeat : selectedBeat;
    if (firstEmpty >= 0) setSelectedBeat(nextBeat);
    setTimelineBeat(nextBeat);
    setPreviewSlot({ characterId, beat: nextBeat });
    setPlanningMessage(`${displayState.characters[characterId].name}의 계획을 편집합니다.`);
  }

  function isValidPendingTile(position: PvePosition): boolean {
    if (!pendingDefinition || pendingDefinition.targetType !== "TILE") return false;
    return validatePvePlannedAction(
      initialState,
      plans,
      selectedId,
      selectedBeat,
      {
        actionId: pendingDefinition.id,
        target: { type: "TILE", position },
      },
    ).valid;
  }

  function clearSlot(characterId: PveCharacterId, beat: PveBeat): void {
    if (locked) return;
    const next = clonePlans(plans);
    next[characterId][beat - 1] = null;
    setPlans(next);
    setSelectedId(characterId);
    setSelectedBeat(beat);
    setTimelineBeat(beat);
    setPreviewSlot({ characterId, beat });
    setPendingActionId(null);
    setPlanningMessage(`${displayState.characters[characterId].name}의 ${beat}번 슬롯을 비웠습니다.`);
  }

  function startSimulation(): void {
    if (!complete || locked) return;
    const nextResolution = resolvePveTurn(initialState, plans);
    playback.start(nextResolution, initialState);
    setPendingActionId(null);
    setPlanningMessage("계획을 잠그고 전투 결과를 재생합니다.");
  }

  function showFinalResult(): void {
    playback.skip();
  }

  function resetPrototype(): void {
    const nextInitial = createInitialPveBattleState();
    setInitialState(nextInitial);
    playback.reset(nextInitial);
    setPlans(createEmptyPvePlans());
    setSelectedId("WARRIOR");
    setSelectedBeat(1);
    setTimelineBeat(1);
    setPreviewSlot({ characterId: "WARRIOR", beat: 1 });
    setPendingActionId(null);
    setPlanningMessage("행동 슬롯을 고른 뒤 카드를 선택하세요.");
  }

  const visibleEvents = playback.resolution
    ? playback.resolution.events.slice(0, playback.eventIndex + 1)
    : [];
  const previewMoveDestination = previewDefinition?.phase === "MOVE"
    ? previewPlannedAction?.target?.type === "TILE"
      ? previewPlannedAction.target.position
      : previewDefinition.id === "ARCHER_RETREAT_SHOT"
        ? previewGeometry?.origin ?? null
        : null
    : null;
  const previewSupportTargetId = previewDefinition?.targetType === "ALLY"
    && previewPlannedAction?.target?.type === "ALLY"
    ? previewPlannedAction.target.characterId
    : null;
  const displayTimelineBeat = currentEvent?.beat
    ?? playback.resolution?.timeline[0]?.beat
    ?? timelineBeat;
  const allTimelineItems = playback.resolution
    ? buildPlaybackTimelineItems(playback.resolution.timeline, playback.eventIndex)
    : buildPlanningTimelineItems(getPvePlannedActionOrder(plans, timelineBeat));
  const timelineItems = allTimelineItems.filter((entry) =>
    entry.beat === displayTimelineBeat
  );
  const activeTimelineItem = allTimelineItems.find((entry) =>
    entry.visualStatus === "ACTIVE"
  ) ?? null;
  const nextTimelineItem = allTimelineItems.find((entry) => entry.isNext) ?? null;
  const currentActorId = isCharacterId(activeTimelineItem?.actorId)
    ? activeTimelineItem.actorId
    : null;
  const currentBossIntent = currentEvent
    ? PVE_BOSS_INTENTS[currentEvent.beat - 1]
    : null;
  const tauntedThisBeat = currentEvent
    ? visibleEvents.some((event) =>
      event.beat === currentEvent.beat && event.type === "TAUNT_APPLIED"
    )
    : false;
  const defendedThisBeat = new Set(
    currentEvent?.type === "BEAT_FINISHED"
      ? []
      : visibleEvents
        .filter((event) =>
          event.beat === currentEvent?.beat
          && event.type === "DAMAGE_REDUCTION_APPLIED"
          && event.targetCharacterId
        )
        .map((event) => event.targetCharacterId!),
  );
  const bossTargetId = currentEvent?.beat === 2
    ? tauntedThisBeat ? "WARRIOR" : trackingTargetId
    : null;
  const isPlayerAttackPreparing = currentEvent?.type === "ACTION_STARTED"
    && currentEvent.phase === "ATTACK"
    && currentActorId !== null;
  const projectileStyle = currentEvent?.actionId === "ARCHER_SHOT"
    || currentEvent?.actionId === "ARCHER_RETREAT_SHOT"
    || currentEvent?.actionId === "ARCHER_ARROW_RAIN"
    ? "ARROW"
    : currentEvent?.actionId === "MAGE_FIREBALL"
      || currentEvent?.actionId === "MAGE_LIGHTNING"
      ? "MAGIC"
      : currentEvent?.actionId === "PRIEST_HOLY_LIGHT"
        ? "HOLY"
        : "MELEE";
  const bossIsActing = activeTimelineItem?.actorId === "BOSS";
  const bossWasHit = currentEvent?.type === "BOSS_DAMAGED";
  const boardIsQuaking = bossIsActing && currentEvent?.beat === 3;
  const playbackFinished = playback.resolution
    ? playback.eventIndex >= playback.resolution.events.length - 1
    : false;

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span>BT</span>
          <div><strong>BLIND TURN</strong><small>PvE TACTICAL LAB</small></div>
        </div>
        <div className={styles.headerStatus}>
          <span className={styles.statusDot} />
          결정론적 3비트 시뮬레이션
        </div>
        <div className={styles.headerActions}>
          <Link href="/">PvP로 돌아가기</Link>
          <button type="button" onClick={resetPrototype}>초기화</button>
        </div>
      </header>

      <section className={styles.workspace}>
        <section className={styles.upperGrid}>
          <section className={styles.battleArena}>
            <div className={styles.arenaHeader}>
              <div className={styles.panelHeader}>
                <div><span>6 × 4 GRID + BOSS AREA</span><h1 className={styles.battleArenaTitle}>전술 전장</h1></div>
                <div className={styles.axisHint}>후열 x=0 <b>→</b> 전열 x=5 <b>▶</b> 보스 x=6</div>
              </div>
              <div className={styles.intentStrip} aria-label="보스 행동 예고">
                {PVE_BOSS_INTENTS.map((intent) => (
                  <article
                    className={`${currentBeat === intent.beat ? styles.activeIntent : ""} ${bossIsActing && currentBeat === intent.beat ? styles.bossIntentExecuting : ""} ${locked && currentBeat !== intent.beat ? styles.mutedIntent : ""}`}
                    key={intent.id}
                  >
                    <span>{["①", "②", "③"][intent.beat - 1]}</span>
                    <div><strong>{intent.name}</strong><p>{intent.description}</p></div>
                  </article>
                ))}
              </div>
            </div>

            <div className={styles.timelinePanel}>
              <ActionTimeline
                beat={displayTimelineBeat}
                characters={displayState.characters}
                items={timelineItems}
                onBeatChange={setTimelineBeat}
                planning={!locked}
              />
              <CurrentActionBanner
                activeItem={activeTimelineItem}
                beat={displayTimelineBeat}
                bossName={displayState.boss.name}
                characters={displayState.characters}
                currentEvent={currentEvent}
                nextItem={nextTimelineItem}
                planning={!locked}
              />
            </div>

            <div className={`${styles.arenaBody} ${boardIsQuaking ? styles.boardQuake : ""}`}>
              <div className={`${styles.boardWrap} ${!locked ? styles.globalDanger : currentBeat === 3 ? styles.globalDangerActive : styles.globalDangerMuted}`}>
                <div className={styles.globalDangerLabel}>③ 전장 전체 공격</div>
                <div className={`${styles.board} ${activeTimelineItem ? styles.boardHasActiveActor : ""}`} aria-label="6x4 전술 전장">
                  {tiles.map((position) => {
                    const character = PVE_CHARACTER_ORDER
                      .map((id) => displayState.characters[id])
                      .find((candidate) =>
                        candidate.position.x === position.x
                        && candidate.position.y === position.y
                      );
                    const validTarget = isValidPendingTile(position);
                    const inUseRange = visibleUseRange.some((tile) => samePosition(tile, position));
                    const inEffectArea = visibleEffectArea.some((tile) => samePosition(tile, position));
                    const isAttackCenter = visibleCenter
                      ? samePosition(visibleCenter, position)
                      : false;
                    const isMoveDestination = previewMoveDestination
                      ? samePosition(previewMoveDestination, position)
                      : false;
                    const showPlayerMarker = !locked
                      && (inEffectArea || isAttackCenter || isMoveDestination);
                    const isCurrentActor = character?.id === currentActorId;
                    const isMoving = character?.id === currentActorId
                      && currentEvent?.type === "MOVED";
                    const isHit = character?.id === currentEvent?.targetCharacterId
                      && currentEvent?.type === "CHARACTER_DAMAGED";
                    const isHealed = character?.id === currentEvent?.targetCharacterId
                      && currentEvent?.type === "HEALED";
                    const actionFailed = character?.id === currentActorId
                      && currentEvent?.type === "ACTION_FAILED";
                    const isDefending = character
                      ? defendedThisBeat.has(character.id)
                      : false;
                    const isTaunting = character?.id === "WARRIOR"
                      && tauntedThisBeat
                      && currentEvent?.type !== "BEAT_FINISHED";
                    const isSupportTarget = character
                      && (previewSupportTargetId === character.id
                        || (pendingDefinition?.targetType === "ALLY" && character.alive));
                    const moveStyle = isMoving && currentEvent?.from && currentEvent.to
                      ? {
                        "--move-x": `${(currentEvent.from.x - currentEvent.to.x) * 105}%`,
                        "--move-y": `${(currentEvent.from.y - currentEvent.to.y) * 105}%`,
                      } as CSSProperties
                      : undefined;
                    return (
                      <button
                        aria-label={`타일 ${position.x}, ${position.y}${character ? ` ${character.name}` : " 빈 타일"}`}
                        className={`${styles.tile} ${position.x === 4 ? styles.columnDanger : ""} ${position.x === 4 && locked && currentBeat !== 1 ? styles.dangerMuted : ""} ${position.x === 4 && currentBeat === 1 ? styles.dangerActive : ""} ${validTarget ? styles.validTarget : ""} ${validTarget && pendingDefinition?.phase === "MOVE" ? styles.moveRange : ""} ${validTarget && pendingDefinition?.phase === "ATTACK" ? styles.attackUseRange : ""} ${inUseRange ? styles.attackUseRange : ""} ${inEffectArea ? styles.attackEffectArea : ""} ${isAttackCenter ? styles.attackCenter : ""} ${isMoveDestination ? styles.moveDestination : ""}`}
                        disabled={locked
                          || (pendingDefinition?.targetType === "TILE" && !validTarget)
                          || (pendingDefinition?.targetType === "ALLY" && !character)}
                        key={tileKey(position)}
                        onClick={() => {
                          if (pendingDefinition?.targetType === "TILE") selectTile(position);
                          else if (character) selectCharacter(character.id);
                          else selectTile(position);
                        }}
                        type="button"
                      >
                        <span className={styles.coordinate}>x{position.x} · y{position.y}</span>
                        {position.x === 4 && <span className={styles.warningOne}>①</span>}
                        {showPlayerMarker && <span className={styles.playerRangeMarker}>P{previewBeat}</span>}
                        {character && (
                          <span
                            className={`${styles.characterUnit} ${selectedId === character.id ? styles.selectedToken : ""} ${!character.alive ? styles.deadToken : ""} ${isCurrentActor ? styles.currentActorToken : ""} ${isMoving ? styles.tokenMoving : ""} ${isHit ? styles.tokenHit : ""} ${isHealed ? styles.tokenHealed : ""} ${actionFailed ? styles.tokenFailed : ""} ${isDefending ? styles.tokenDefending : ""} ${isTaunting ? styles.tokenTaunting : ""} ${isSupportTarget ? styles.supportTarget : ""} ${isPlayerAttackPreparing && isCurrentActor ? styles.tokenAttacking : ""}`}
                            style={moveStyle}
                          >
                            {trackingTargetId === character.id && (
                              <b className={`${styles.trackingMarker} ${locked && currentBeat !== 2 ? styles.dangerMuted : ""}`}>②</b>
                            )}
                            {isTaunting && <b className={styles.tauntMark}>!</b>}
                            {isDefending && <b className={styles.defenseAura}>◆</b>}
                            <strong className={styles.characterToken}>{character.token}</strong>
                            {isCurrentActor && <small className={styles.actorStatusBadge}>행동 중</small>}
                            <em className={styles.characterHp}>HP {character.hp}/{character.maxHp}</em>
                            {character.shield > 0 && <i>◆{character.shield}</i>}
                            {isHit && <b className={styles.damageFloat}>-{currentEvent.amount}</b>}
                            {isHealed && <b className={styles.healFloat}>+{currentEvent.amount}</b>}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className={styles.bossConnector} aria-hidden="true">
                <span>보스 영역</span><b>▶</b>
              </div>

              <div className={styles.bossLane}>
                <section className={styles.bossCard}>
                  <header className={styles.bossHeader}>
                    <strong className={styles.bossName}>{displayState.boss.name}</strong>
                    {bossIsActing && <small className={styles.bossActorBadge}>행동 중</small>}
                    <span className={styles.bossCoordinate}>위치 x=6 · y=1~2</span>
                  </header>
                  <div className={styles.bossVisual}>
                    <div className={`${styles.bossStatue} ${bossIsActing ? styles.bossActing : ""} ${bossWasHit ? styles.bossHit : ""}`} aria-label="훈련용 골렘 임시 외형">
                      <span className={styles.bossEyes}><i /><i /></span>
                    </div>
                    <strong className={styles.bossLabel}>BOSS</strong>
                  </div>
                  <div className={styles.hpReadout}>
                    <div className={styles.hpTrack}><span style={{ width: `${displayState.boss.hp / displayState.boss.maxHp * 100}%` }} /></div>
                    <div className={styles.hpNumbers}><span>HP</span><strong>{displayState.boss.hp} / {displayState.boss.maxHp}</strong></div>
                    {displayState.boss.marked && <b>표식 · 받는 피해 +25%</b>}
                  </div>
                  <div className={styles.bossCurrentIntent}>
                    <span>{currentEvent ? `패턴 ${["①", "②", "③"][currentEvent.beat - 1]}` : "② 추적 대상"}</span>
                    <strong>{currentEvent ? currentBossIntent?.name : displayState.characters[trackingTargetId].name}</strong>
                  </div>
                  <div className={styles.bossVirtualArea} aria-label="가상 보스 점유 영역">
                    {displayState.boss.occupiedTiles.map((position) => {
                      const validTarget = isValidPendingTile(position);
                      const inUseRange = visibleUseRange.some((tile) => samePosition(tile, position));
                      const inEffectArea = visibleEffectArea.some((tile) => samePosition(tile, position));
                      const isAttackCenter = visibleCenter
                        ? samePosition(visibleCenter, position)
                        : false;
                      return (
                        <button
                          aria-label={`보스 점유 타일 ${position.x}, ${position.y}`}
                          className={`${styles.bossVirtualTile} ${validTarget ? styles.validTarget : ""} ${inUseRange ? styles.attackUseRange : ""} ${inEffectArea ? styles.attackEffectArea : ""} ${isAttackCenter ? styles.attackCenter : ""}`}
                          disabled={locked || pendingDefinition?.targetType !== "TILE" || !validTarget}
                          key={tileKey(position)}
                          onClick={() => selectTile(position)}
                          type="button"
                        >
                          ({position.x},{position.y})
                        </button>
                      );
                    })}
                  </div>
                  {bossWasHit && <b className={styles.bossDamageFloat}>-{currentEvent?.amount}</b>}
                </section>
              </div>

              {isPlayerAttackPreparing && projectileStyle !== "MELEE" && currentActorId && (
                <span
                  className={`${styles.projectile} ${projectileStyle === "ARROW" ? styles.arrowProjectile : projectileStyle === "MAGIC" ? styles.magicProjectile : styles.holyProjectile}`}
                  key={currentEvent?.id}
                  style={{
                    "--source-left": `${(displayState.characters[currentActorId].position.x + 0.5) / 6 * 63}%`,
                    "--source-top": `${(displayState.characters[currentActorId].position.y + 0.5) / 4 * 100}%`,
                  } as CSSProperties}
                />
              )}
              {currentEvent?.type === "BOSS_ACTION_STARTED" && currentEvent.beat === 2 && bossTargetId && (
                <span
                  className={styles.bossProjectile}
                  key={`${currentEvent.id}-bolt`}
                  style={{
                    "--target-left": `${(displayState.characters[bossTargetId].position.x + 0.5) / 6 * 63}%`,
                    "--target-top": `${(displayState.characters[bossTargetId].position.y + 0.5) / 4 * 100}%`,
                  } as CSSProperties}
                />
              )}
              <BeatTransitionOverlay
                beat={currentEvent?.type === "BEAT_STARTED" ? currentEvent.beat : null}
              />
            </div>
          </section>

          <aside className={styles.planSummary}>
            <div className={styles.summaryParty}>
              <div className={styles.panelHeader}>
                <div><span>PARTY PLAN</span><h2>전체 행동 요약</h2></div>
                <b>{actionCount(plans)} / 12</b>
              </div>
              <div className={styles.partyPlans}>
                {PVE_CHARACTER_ORDER.map((characterId) => {
                  const character = displayState.characters[characterId];
                  return (
                    <article className={`${styles.partyPlanCard} ${selectedId === characterId ? styles.selectedPlan : ""}`} key={characterId}>
                      <button className={styles.partyPlanCharacter} type="button" onClick={() => selectCharacter(characterId)} disabled={locked}>
                        <span>{character.token}</span><strong>{character.name}</strong><small>HP {character.hp}/{character.maxHp}</small>
                      </button>
                      <div className={styles.partyPlanActions}>
                        {BEATS.map((beat) => {
                          const planned = plans[characterId][beat - 1];
                          const target = summaryTargetLabel(planned?.target, displayState.characters);
                          return (
                            <button
                              aria-label={`${character.name} ${beat}번 행동 ${planned ? PVE_ACTIONS[planned.actionId].name : "비어 있음"}${target ? ` ${target}` : ""}`}
                              className={`${styles.partyPlanAction} ${currentBeat === beat ? styles.activePlanBeat : ""}`}
                              disabled={locked}
                              key={beat}
                              onClick={() => {
                                setSelectedId(characterId);
                                setSelectedBeat(beat);
                                setTimelineBeat(beat);
                                setPendingActionId(null);
                                setPreviewSlot({ characterId, beat });
                              }}
                              type="button"
                            >
                              <b>{BEAT_MARKERS[beat - 1]}</b>
                              <span className={styles.planActionLine}>
                                <strong className={styles.planActionName}>{planned ? PVE_ACTIONS[planned.actionId].name : "비어 있음"}</strong>
                                {target && <small className={styles.planActionTarget}>{target}</small>}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
            <div className={styles.summaryMeta}>
              <div className={styles.priorityNote}>
                <b>고정 해결 순서</b>
                <span>선제·방어 → 이동 → 지원 → 공격 → 보스 → 상태</span>
                <small>동일 우선도: 전사 → 궁수 → 마법사 → 사제</small>
              </div>
            </div>
          </aside>
        </section>

        <section className={styles.commandPanel}>
          <div className={styles.characterCommand}>
            <div className={styles.commandTitle}>
              <span className={styles.commandToken}>{selectedCharacter.token}</span>
              <div><small>SELECTED CHARACTER</small><h2>{selectedCharacter.name} 행동 계획</h2></div>
              <div className={styles.selectedStats}>HP {selectedCharacter.hp}/{selectedCharacter.maxHp}<b>보호막 {selectedCharacter.shield}</b></div>
            </div>
            <div className={styles.slotRow}>
              {BEATS.map((beat) => {
                const planned = plans[selectedId][beat - 1];
                return (
                  <div className={`${styles.planSlot} ${selectedBeat === beat ? styles.activeSlot : ""}`} key={beat}>
                    <button
                      disabled={locked}
                      onClick={() => {
                        setSelectedBeat(beat);
                        setTimelineBeat(beat);
                        setPendingActionId(null);
                        setPreviewSlot({ characterId: selectedId, beat });
                      }}
                      type="button"
                    >
                      <span>BEAT {beat}</span>
                      <strong>{planned ? PVE_ACTIONS[planned.actionId].name : "행동 선택"}</strong>
                      <small>{planned ? targetLabel(planned.target) : "카드를 배치하세요"}</small>
                    </button>
                    {planned && !locked && (
                      <button aria-label={`${beat}번 행동 제거`} className={styles.removeAction} onClick={() => clearSlot(selectedId, beat)} type="button">×</button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className={styles.cardRow} aria-label={`${selectedCharacter.name} 행동 카드`}>
              {actions.map((action) => (
                <button
                  className={`${styles.actionCard} ${pendingActionId === action.id ? styles.pendingCard : ""}`}
                  disabled={locked}
                  key={action.id}
                  onClick={() => selectAction(action.id)}
                  type="button"
                >
                  <span>{action.phase}</span>
                  <strong>{action.name}</strong>
                  <p>{action.description}</p>
                  <small>{action.damageType ?? action.targetType}</small>
                </button>
              ))}
            </div>
          </div>

          <aside className={styles.playbackPanel}>
            <div className={styles.playbackHeader}>
              <div><span>SIMULATION</span><h2>{locked ? "재생 제어" : "계획 상태"}</h2></div>
              <b>{complete ? "READY" : `${actionCount(plans)}/12`}</b>
            </div>
            {!locked ? (
              <>
                <p className={styles.planningMessage}>{planningMessage}</p>
                <button className={styles.startButton} disabled={!complete} onClick={startSimulation} type="button">
                  시뮬레이션 시작 <span>▶</span>
                </button>
                <small className={styles.lockHint}>시작하면 12개 행동이 잠기고 결과를 먼저 계산합니다.</small>
              </>
            ) : (
              <>
                <div className={styles.playbackControls}>
                  <button disabled={playbackFinished} onClick={playback.toggle} type="button">
                    {playback.isPlaying ? "일시 정지" : "계속 재생"}
                  </button>
                  <button onClick={showFinalResult} type="button">전체 결과 보기</button>
                </div>
                <div className={styles.resultState}>
                  <span>RESULT</span>
                  <strong>{displayState.result === "VICTORY" ? "승리" : displayState.result === "DEFEAT" ? "패배" : playbackFinished ? "턴 완료" : "진행 중"}</strong>
                </div>
                <div className={styles.eventLog} aria-label="전투 행동 로그">
                  {visibleEvents.length === 0 && <p>첫 행동을 준비 중입니다.</p>}
                  {[...visibleEvents].reverse().map((event) => (
                    <article key={event.id}>
                      <span>{event.beat} · {PHASE_LABELS[event.phase]}</span>
                      <p>{event.message}</p>
                    </article>
                  ))}
                </div>
              </>
            )}
          </aside>
        </section>
      </section>
    </main>
  );
}
