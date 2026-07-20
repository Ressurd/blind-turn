"use client";

import {
  createEmptyPvePlans,
  createInitialPveBattleState,
  getPveActionsForCharacter,
  isPvePlanComplete,
  PVE_ACTIONS,
  PVE_BOARD_HEIGHT,
  PVE_BOARD_WIDTH,
  PVE_BOSS_INTENTS,
  PVE_CHARACTER_ORDER,
  resolvePveTurn,
  selectPveTrackingTarget,
  validatePvePlannedAction,
  type PveActionId,
  type PveActionTarget,
  type PveBattleState,
  type PveBeat,
  type PveCharacterId,
  type PveCombatEvent,
  type PvePlans,
  type PvePosition,
  type PveTurnResolution,
} from "@blind-turn/shared";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "./PvePrototype.module.css";

const BEATS: readonly PveBeat[] = [1, 2, 3];
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

function tileKey(position: PvePosition): string {
  return `${position.x}:${position.y}`;
}

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
  const [displayState, setDisplayState] = useState<PveBattleState>(initialState);
  const [plans, setPlans] = useState<PvePlans>(() => createEmptyPvePlans());
  const [selectedId, setSelectedId] = useState<PveCharacterId>("WARRIOR");
  const [selectedBeat, setSelectedBeat] = useState<PveBeat>(1);
  const [pendingActionId, setPendingActionId] = useState<PveActionId | null>(null);
  const [planningMessage, setPlanningMessage] = useState(
    "행동 슬롯을 고른 뒤 카드를 선택하세요.",
  );
  const [resolution, setResolution] = useState<PveTurnResolution | null>(null);
  const [playbackIndex, setPlaybackIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);

  const locked = resolution !== null;
  const complete = isPvePlanComplete(plans);
  const currentEvent = resolution && playbackIndex >= 0
    ? resolution.events[playbackIndex] ?? null
    : null;
  const currentBeat = currentEvent?.beat ?? null;
  const trackingTargetId = resolution?.trackingTargetId
    ?? selectPveTrackingTarget(initialState);
  const selectedCharacter = displayState.characters[selectedId];
  const actions = getPveActionsForCharacter(selectedId);
  const pendingDefinition = pendingActionId ? PVE_ACTIONS[pendingActionId] : null;

  const tiles = useMemo(() => {
    const result: PvePosition[] = [];
    for (let y = 0; y < PVE_BOARD_HEIGHT; y += 1) {
      for (let x = 0; x < PVE_BOARD_WIDTH; x += 1) result.push({ x, y });
    }
    return result;
  }, []);

  useEffect(() => {
    if (!isPlaying || !resolution) return;
    if (playbackIndex >= resolution.events.length - 1) {
      setIsPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      const nextIndex = playbackIndex + 1;
      const event = resolution.events[nextIndex];
      if (!event) {
        setIsPlaying(false);
        return;
      }
      setPlaybackIndex(nextIndex);
      setDisplayState(event.state);
    }, playbackIndex < 0 ? 180 : 420);
    return () => window.clearTimeout(timer);
  }, [isPlaying, playbackIndex, resolution]);

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
    setPendingActionId(null);
    setPlanningMessage(
      `${selectedCharacter.name}의 ${selectedBeat}번 슬롯에 ${PVE_ACTIONS[actionId].name}을 배치했습니다.`,
    );
    chooseNextSlot(next);
  }

  function selectAction(actionId: PveActionId): void {
    if (locked) return;
    const definition = PVE_ACTIONS[actionId];
    if (definition.targetType === "NONE") {
      commitAction(actionId);
      return;
    }
    setPendingActionId(actionId);
    setPlanningMessage(
      definition.targetType === "TILE"
        ? `${definition.name}: 전장에서 이동할 타일을 선택하세요.`
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
    if (firstEmpty >= 0) setSelectedBeat((firstEmpty + 1) as PveBeat);
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
    setPendingActionId(null);
    setPlanningMessage(`${displayState.characters[characterId].name}의 ${beat}번 슬롯을 비웠습니다.`);
  }

  function startSimulation(): void {
    if (!complete || locked) return;
    const nextResolution = resolvePveTurn(initialState, plans);
    setResolution(nextResolution);
    setPlaybackIndex(-1);
    setDisplayState(initialState);
    setIsPlaying(true);
    setPendingActionId(null);
    setPlanningMessage("계획을 잠그고 전투 결과를 재생합니다.");
  }

  function showFinalResult(): void {
    if (!resolution) return;
    setPlaybackIndex(resolution.events.length - 1);
    setDisplayState(resolution.state);
    setIsPlaying(false);
  }

  function resetPrototype(): void {
    const nextInitial = createInitialPveBattleState();
    setInitialState(nextInitial);
    setDisplayState(nextInitial);
    setPlans(createEmptyPvePlans());
    setSelectedId("WARRIOR");
    setSelectedBeat(1);
    setPendingActionId(null);
    setPlanningMessage("행동 슬롯을 고른 뒤 카드를 선택하세요.");
    setResolution(null);
    setPlaybackIndex(-1);
    setIsPlaying(false);
  }

  const visibleEvents = resolution
    ? resolution.events.slice(0, playbackIndex + 1)
    : [];

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
          <section className={`${styles.boardPanel} ${styles.globalWarning}`}>
            <div className={styles.panelHeader}>
              <div><span>6 × 4 GRID</span><h1>전술 전장</h1></div>
              <div className={styles.axisHint}>후열 x=0 <b>→</b> 전열 x=5</div>
            </div>
            <div className={styles.globalDangerLabel}>③ 전장 전체 · 대지 진동</div>
            <div className={styles.board} aria-label="6x4 전술 전장">
              {tiles.map((position) => {
                const character = PVE_CHARACTER_ORDER
                  .map((id) => displayState.characters[id])
                  .find((candidate) =>
                    candidate.position.x === position.x
                    && candidate.position.y === position.y
                  );
                const validTarget = isValidPendingTile(position);
                return (
                  <button
                    aria-label={`타일 ${position.x}, ${position.y}${character ? ` ${character.name}` : " 빈 타일"}`}
                    className={`${styles.tile} ${position.x === 4 ? styles.columnDanger : ""} ${validTarget ? styles.validTarget : ""}`}
                    disabled={locked || (Boolean(pendingDefinition) && !validTarget && !character)}
                    key={tileKey(position)}
                    onClick={() => {
                      if (character) selectCharacter(character.id);
                      else selectTile(position);
                    }}
                    type="button"
                  >
                    <span className={styles.coordinate}>x{position.x} · y{position.y}</span>
                    {position.x === 4 && <span className={styles.warningOne}>①</span>}
                    {character && (
                      <span
                        className={`${styles.characterToken} ${selectedId === character.id ? styles.selectedToken : ""} ${!character.alive ? styles.deadToken : ""}`}
                      >
                        {trackingTargetId === character.id && <b className={styles.trackingMarker}>②</b>}
                        <strong>{character.token}</strong>
                        <small>{character.name}</small>
                        <em>HP {character.hp}/{character.maxHp}</em>
                        {character.shield > 0 && <i>보호막 {character.shield}</i>}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className={styles.currentAction}>
              <span>{currentEvent ? `${currentEvent.beat} 비트 · ${PHASE_LABELS[currentEvent.phase]}` : "PLAN PHASE"}</span>
              <strong>{currentEvent?.message ?? planningMessage}</strong>
            </div>
          </section>

          <aside className={styles.bossPanel}>
            <div className={styles.bossIdentity}>
              <span>TRAINING TARGET</span>
              <strong>훈련용 골렘</strong>
              <div className={styles.bossGlyph}>G</div>
            </div>
            <div className={styles.hpReadout}>
              <div><span>BOSS HP</span><strong>{displayState.boss.hp} / {displayState.boss.maxHp}</strong></div>
              <div className={styles.hpTrack}><span style={{ width: `${displayState.boss.hp / displayState.boss.maxHp * 100}%` }} /></div>
              {displayState.boss.marked && <b>표식 · 받는 피해 +25%</b>}
            </div>
            <div className={styles.intentList}>
              {PVE_BOSS_INTENTS.map((intent) => (
                <article className={currentBeat === intent.beat ? styles.activeIntent : ""} key={intent.id}>
                  <span>{intent.beat}</span>
                  <div><strong>{intent.name}</strong><p>{intent.description}</p></div>
                </article>
              ))}
            </div>
            <div className={styles.trackingTarget}>
              <span>② 추적 예고 대상</span>
              <strong>{displayState.characters[trackingTargetId].name}</strong>
              <small>거리 동률 우선순위: 전사 → 궁수 → 마법사 → 사제</small>
            </div>
          </aside>

          <aside className={styles.planSummary}>
            <div className={styles.panelHeader}>
              <div><span>PARTY PLAN</span><h2>전체 행동 요약</h2></div>
              <b>{actionCount(plans)} / 12</b>
            </div>
            <div className={styles.partyPlans}>
              {PVE_CHARACTER_ORDER.map((characterId) => {
                const character = displayState.characters[characterId];
                return (
                  <article className={selectedId === characterId ? styles.selectedPlan : ""} key={characterId}>
                    <button type="button" onClick={() => selectCharacter(characterId)} disabled={locked}>
                      <span>{character.token}</span><strong>{character.name}</strong><small>HP {character.hp}/{character.maxHp}</small>
                    </button>
                    <div>
                      {BEATS.map((beat) => {
                        const planned = plans[characterId][beat - 1];
                        return (
                          <button
                            className={currentBeat === beat ? styles.activePlanBeat : ""}
                            disabled={locked}
                            key={beat}
                            onClick={() => {
                              setSelectedId(characterId);
                              setSelectedBeat(beat);
                              setPendingActionId(null);
                            }}
                            type="button"
                          >
                            <b>{beat}</b>
                            <span>{planned ? PVE_ACTIONS[planned.actionId].name : "비어 있음"}</span>
                          </button>
                        );
                      })}
                    </div>
                  </article>
                );
              })}
            </div>
            <div className={styles.priorityNote}>
              <b>고정 해결 순서</b>
              <span>선제·방어 → 이동 → 지원 → 공격 → 보스 → 상태</span>
              <small>동일 우선도: 전사 → 궁수 → 마법사 → 사제</small>
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
                        setPendingActionId(null);
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
                  <button disabled={playbackIndex >= (resolution?.events.length ?? 0) - 1} onClick={() => setIsPlaying((value) => !value)} type="button">
                    {isPlaying ? "일시 정지" : "계속 재생"}
                  </button>
                  <button onClick={showFinalResult} type="button">전체 결과 보기</button>
                </div>
                <div className={styles.resultState}>
                  <span>RESULT</span>
                  <strong>{displayState.result === "VICTORY" ? "승리" : displayState.result === "DEFEAT" ? "패배" : playbackIndex >= (resolution?.events.length ?? 1) - 1 ? "턴 완료" : "진행 중"}</strong>
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
