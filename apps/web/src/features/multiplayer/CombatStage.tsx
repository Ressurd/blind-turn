"use client";

import { CHARACTER_CATALOG, formatHp, type RoomPlayerView } from "@blind-turn/shared";
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  describeCombatSequence,
  type CombatDisplayState,
  type CombatSequence,
} from "./combat-sequence";
import {
  CLASH_ROULETTE_TICK_MS,
  CLASH_ROULETTE_TOTAL_MS,
  getPlaybackDuration,
  type CombatPlaybackSpeed,
  type CombatPlaybackStage,
  type CombatStatusState,
} from "./use-combat-playback";
/*
 * CombatStage receives the controller's current duration so CSS and the
 * playback timer always finish on the same beat.
 */
type PlaybackStyle = CSSProperties & {
  "--playback-stage-duration": string;
  "--playback-beat-duration": string;
};

type CombatStageProps = {
  players: RoomPlayerView[];
  selfPlayerId: string;
  hostPlayerId: string;
  displayState: CombatDisplayState;
  sequence: CombatSequence | null;
  stage: CombatPlaybackStage;
  clashAttemptIndex: number;
  statuses: CombatStatusState;
  isPlaying: boolean;
  isPaused: boolean;
  speed: CombatPlaybackSpeed;
  durationMs: number;
  onTogglePause: () => void;
  onSpeedChange: (speed: CombatPlaybackSpeed) => void;
  onSkip: () => void;
  selectionEnabled?: boolean;
  selectedPlayerId?: string | null;
  reservationLabels?: Record<string, string[]>;
  onPlayerSelect?: (playerId: string) => void;
};

type Line = { x1: number; y1: number; x2: number; y2: number };

const CLASH_RESULT_STAGES: CombatPlaybackStage[] = [
  "clash-first-result",
  "clash-second-roll",
  "clash-second-result",
  "clash-modifiers",
  "clash-compare",
  "clash-tie",
  "clash-winner",
  "impact",
  "damage",
  "death",
  "summary",
  "transition",
];

const CLASH_SECOND_RESULT_STAGES: CombatPlaybackStage[] = [
  "clash-second-result",
  "clash-modifiers",
  "clash-compare",
  "clash-tie",
  "clash-winner",
  "impact",
  "damage",
  "death",
  "summary",
  "transition",
];

function signed(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

export function createClashRouletteFrames(result: number, offset: number): number[] {
  const transientFrameCount = Math.ceil(
    CLASH_ROULETTE_TOTAL_MS / CLASH_ROULETTE_TICK_MS,
  );
  return Array.from(
    { length: transientFrameCount },
    (_, index) => ((result + offset + index * 7) % 10) + 1,
  ).concat(result);
}

function ClashNumber(props: { roll: number; rolling: boolean; revealed: boolean; offset: number }) {
  if (props.rolling) {
    return (
      <div className="clashRoulette" aria-label="주사위 굴리는 중">
        <div className="clashRouletteTrack">
          {createClashRouletteFrames(props.roll, props.offset).map((value, index) => <span key={`${value}-${index}`}>{value}</span>)}
        </div>
      </div>
    );
  }
  return <strong className="clashFixedNumber">{props.revealed ? props.roll : "?"}</strong>;
}

function ClashDisplay(props: {
  sequence: CombatSequence;
  stage: CombatPlaybackStage;
  attemptIndex: number;
  names: Record<string, string>;
}) {
  const clash = props.sequence.clash;
  if (!clash?.attempts.length) return null;
  const attempt = clash.attempts[props.attemptIndex] ?? clash.attempts.at(-1)!;
  const [firstParticipant, secondParticipant] = clash.participants;
  const [firstRoll, secondRoll] = attempt.rolls;
  const firstRolling = props.stage === "clash-first-roll";
  const secondRolling = props.stage === "clash-second-roll";
  const firstRevealed = CLASH_RESULT_STAGES.includes(props.stage);
  const secondRevealed = CLASH_SECOND_RESULT_STAGES.includes(props.stage);
  const showModifiers = ["clash-modifiers", "clash-compare", "clash-tie", "clash-winner", "impact", "damage", "death", "summary", "transition"].includes(props.stage);
  const showComparison = ["clash-compare", "clash-tie", "clash-winner", "impact", "damage", "death", "summary", "transition"].includes(props.stage);
  const showWinner = ["clash-winner", "impact", "damage", "death", "summary", "transition"].includes(props.stage);
  const isFirstActive = firstRolling || props.stage === "clash-first-result";
  const isSecondActive = secondRolling || props.stage === "clash-second-result";

  const participant = (
    side: "first" | "second",
    entry: typeof firstParticipant,
    roll: typeof firstRoll,
    active: boolean,
    rolling: boolean,
    revealed: boolean,
  ) => (
    <article className={[
      "clashParticipant",
      active ? "active" : "",
      showWinner && props.sequence.winnerId === entry.playerId ? "winner" : "",
      showWinner && props.sequence.loserId === entry.playerId ? "loser" : "",
    ].filter(Boolean).join(" ")}>
      <header>
        <strong>{props.names[entry.playerId]}</strong>
        <span>{entry.cardName}</span>
        {showWinner ? (
          <em className={props.sequence.winnerId === entry.playerId ? "clashWinBadge" : "clashLoseBadge"}>
            {props.sequence.winnerId === entry.playerId ? "합 승리" : "합 패배"}
          </em>
        ) : null}
      </header>
      <ClashNumber roll={roll.roll} rolling={rolling} revealed={revealed} offset={side === "first" ? 1 : 5} />
      {showModifiers ? (
        <dl className="clashModifiers">
          <div><dt>주사위</dt><dd>{roll.roll}</dd></div>
          <div><dt>카드 보정</dt><dd>{signed(roll.cardBonus ?? 0)}</dd></div>
          <div><dt>캐릭터 보정</dt><dd>{signed(roll.characterBonus ?? 0)}</dd></div>
          <div className="total"><dt>최종</dt><dd>{roll.total}</dd></div>
        </dl>
      ) : null}
    </article>
  );

  return (
    <div className="clashDisplay" aria-label={`합 ${attempt.attemptNumber}회차`}>
      {attempt.attemptNumber > 1 ? <p className="clashRematch">재대결 {attempt.attemptNumber}회차</p> : null}
      <div className="clashParticipants">
        {participant("first", firstParticipant, firstRoll, isFirstActive, firstRolling, firstRevealed)}
        <div className="clashVersus">
          <span>VS</span>
          {showComparison ? <strong>{firstRoll.total} : {secondRoll.total}</strong> : null}
        </div>
        {participant("second", secondParticipant, secondRoll, isSecondActive, secondRolling, secondRevealed)}
      </div>
      {props.stage === "clash-tie" ? <strong className="clashOutcome tie">무승부! 다시 굴립니다.</strong> : null}
      {showWinner ? <strong className="clashOutcome">{props.names[props.sequence.winnerId ?? ""] ?? "플레이어"} 승리!</strong> : null}
    </div>
  );
}

function presentation(
  sequence: CombatSequence | null,
  stage: CombatPlaybackStage,
  names: Record<string, string>,
  clashAttemptIndex: number,
): { eyebrow: string; title: string; detail: string; tone: string } {
  const name = (id: string | null | undefined) => id ? names[id] ?? "플레이어" : "플레이어";
  if (!sequence) return {
    eyebrow: "COMBAT STAGE",
    title: "카드를 선택하세요",
    detail: "턴이 확정되면 모든 플레이어의 카드가 여기서 동시에 공개됩니다.",
    tone: "idle",
  };
  if (sequence.type === "ROUND") return {
    eyebrow: `TURN ${sequence.roundNumber}`,
    title: `${sequence.roundNumber}턴 판정 시작`,
    detail: "각 플레이어가 선택한 한 장을 동시에 공개합니다.",
    tone: "round",
  };
  if (sequence.type === "ROUND_SUMMARY") return {
    eyebrow: `TURN ${sequence.roundNumber} · COMPLETE`,
    title: `${sequence.roundNumber}턴 판정 완료`,
    detail: "이번 턴의 결과와 체력 변경이 반영되었습니다.",
    tone: "result",
  };
  if (sequence.type === "DECK" || stage.startsWith("reshuffle") || stage === "draw") {
    const reshuffle = sequence.reshuffles[0];
    const draw = sequence.draws[0];
    if (stage === "turn-intro") return {
      eyebrow: "DECK UPDATE",
      title: reshuffle ? "덱 소진을 확인합니다" : "드로우를 준비합니다",
      detail: reshuffle ? "무덤 카드만 새 덱으로 돌아갑니다." : "카드 종류와 순서는 공개되지 않습니다.",
      tone: "deck",
    };
    if (stage === "reshuffle-start") return {
      eyebrow: "DECK EMPTY",
      title: "덱이 비었습니다",
      detail: `무덤 ${reshuffle?.discardCount ?? 0}장을 다시 준비합니다.`,
      tone: "deck",
    };
    if (stage === "reshuffle-shuffle") return {
      eyebrow: "RESHUFFLE",
      title: "무덤의 카드를 다시 섞습니다",
      detail: "드로우 순서는 공개되지 않습니다.",
      tone: "deck",
    };
    if (stage === "reshuffle-complete") return {
      eyebrow: "DECK RESTORED",
      title: `덱 ${reshuffle?.shuffledCount ?? 0}장 · 무덤 0장`,
      detail: "셔플이 완료되었습니다.",
      tone: "deck",
    };
    if (stage === "draw") return {
      eyebrow: "CARD DRAW",
      title: `카드 ${draw?.count ?? 0}장을 뽑았습니다`,
      detail: `손패 ${draw?.handCount ?? 0}장 · 덱 ${draw?.drawPileCount ?? 0}장`,
      tone: "deck",
    };
  }
  if (sequence.type === "GAME_OVER") return {
    eyebrow: "BATTLE COMPLETE",
    title: sequence.winnerId ? `${name(sequence.winnerId)} 승리` : "무승부",
    detail: "최종 전투 결과가 확정되었습니다.",
    tone: "result",
  };
  const turn = "이번 턴";
  if (stage === "turn-intro") return {
    eyebrow: `${turn} · START`,
    title: `${turn} 판정을 시작합니다`,
    detail: "모든 플레이어의 선택 카드를 한 번에 공개합니다.",
    tone: "action",
  };
  if (stage === "reveal") return {
    eyebrow: `${turn} · CARD REVEAL`,
    title: sequence.cards.map((card) => `${name(card.playerId)} · ${card.cardName}`).join("  /  ") || "행동 취소",
    detail: "선택한 행동은 동시에 판정됩니다.",
    tone: "action",
  };
  if (sequence.outcome === "CLASH" && sequence.clash?.attempts.length) {
    const attempt = sequence.clash.attempts[clashAttemptIndex] ?? sequence.clash.attempts.at(-1)!;
    const [first, second] = sequence.clash.participants;
    if (stage === "clash-intro") return {
      eyebrow: `${turn} · CLASH`,
      title: "합 발생!",
      detail: `${name(first.playerId)}와 ${name(second.playerId)}의 공격이 맞부딪칩니다.`,
      tone: "clash",
    };
    if (stage === "clash-first-roll") return {
      eyebrow: `${turn} · CLASH ${attempt.attemptNumber}`,
      title: `${name(first.playerId)}의 합 주사위`,
      detail: "첫 번째 플레이어의 주사위를 굴립니다.",
      tone: "clash",
    };
    if (stage === "clash-first-result") return {
      eyebrow: `${turn} · FIRST RESULT`,
      title: `${name(first.playerId)} · 주사위 ${attempt.rolls[0].roll}`,
      detail: "첫 번째 결과가 확정되었습니다.",
      tone: "clash",
    };
    if (stage === "clash-second-roll") return {
      eyebrow: `${turn} · CLASH ${attempt.attemptNumber}`,
      title: `${name(second.playerId)}의 합 주사위`,
      detail: "두 번째 플레이어의 주사위를 굴립니다.",
      tone: "clash",
    };
    if (stage === "clash-second-result") return {
      eyebrow: `${turn} · SECOND RESULT`,
      title: `${name(second.playerId)} · 주사위 ${attempt.rolls[1].roll}`,
      detail: "두 번째 결과가 확정되었습니다.",
      tone: "clash",
    };
    if (stage === "clash-modifiers") return {
      eyebrow: `${turn} · MODIFIERS`,
      title: "보정값을 적용합니다",
      detail: "기본 주사위와 카드·캐릭터 보정을 각각 확인하세요.",
      tone: "clash",
    };
    if (stage === "clash-compare") return {
      eyebrow: `${turn} · FINAL COMPARE`,
      title: `${name(first.playerId)} ${attempt.rolls[0].total}  VS  ${attempt.rolls[1].total} ${name(second.playerId)}`,
      detail: attempt.tied ? "최종값이 같습니다." : "두 최종값을 비교합니다.",
      tone: "clash",
    };
    if (stage === "clash-tie") return {
      eyebrow: `${turn} · DRAW`,
      title: "무승부! 다시 굴립니다.",
      detail: `다음은 재대결 ${attempt.attemptNumber + 1}회차입니다.`,
      tone: "clash",
    };
    if (stage === "clash-winner") return {
      eyebrow: `${turn} · CLASH WINNER`,
      title: `${name(sequence.winnerId)} 승리!`,
      detail: "승패를 확인한 뒤 피해를 적용합니다.",
      tone: "success",
    };
  }
  if (stage === "roll") {
    if (sequence.outcome === "COUNTER") return {
      eyebrow: `${turn} · COUNTER`,
      title: "반격 발동!",
      detail: `${name(sequence.counterActorId)}의 반격이 공격 방향을 뒤집습니다.`,
      tone: "counter",
    };
    return {
      eyebrow: `${turn} · EVADE CHECK`,
      title: sequence.outcome === "EVADE_FAILURE" ? "회피 실패!" : "회피 성공!",
      detail: "회피 총합과 공격 카드의 회피 난이도를 비교합니다.",
      tone: sequence.outcome === "EVADE_FAILURE" ? "danger" : "success",
    };
  }
  if (stage === "focus") return {
    eyebrow: `${turn} · TARGET`,
    title: `${name(sequence.actorId)}의 행동`,
    detail: sequence.targetIds.length > 0
      ? `대상 · ${sequence.targetIds.map((id) => name(id)).join(" · ")}`
      : "자신 또는 대상 없는 행동입니다.",
    tone: "action",
  };
  if (stage === "impact") return {
    eyebrow: `${turn} · IMPACT`,
    title: sequence.outcome === "EVADE_SUCCESS" ? "공격을 피했습니다!" : sequence.outcome === "CLASH" ? `${name(sequence.winnerId)}의 공격!` : "공격 적중!",
    detail: sequence.outcome === "COUNTER" ? "공격은 취소되고 반격 피해가 동시에 적용됩니다." : sequence.outcome === "CLASH" ? `${name(sequence.loserId)} 방향으로 승자의 공격이 이어집니다.` : "피해 결과를 적용합니다.",
    tone: sequence.outcome === "EVADE_SUCCESS" ? "success" : "danger",
  };
  if (stage === "damage") {
    const damageText = sequence.damages.map((damage) =>
      `${name(damage.playerId)} -${formatHp(damage.damage)}`).join(" · ");
    const healText = sequence.heals.map((heal) =>
      `${name(heal.playerId)} +${formatHp(heal.amount)}`).join(" · ");
    return {
      eyebrow: `${turn} · HP UPDATE`,
      title: damageText || healText,
      detail: sequence.damages.map((damage) =>
        `HP ${formatHp(damage.previousHp)} → ${formatHp(damage.remainingHp)}`).join("  /  "),
      tone: sequence.damages.length ? "damage" : "success",
    };
  }
  if (stage === "death") return {
    eyebrow: `${turn} · PLAYER DOWN`,
    title: `${name(sequence.deathPlayerIds[0])}님이 쓰러졌습니다.`,
    detail: "이번 턴에 확정한 행동은 모두 판정된 뒤 사망을 적용합니다.",
    tone: "death",
  };
  if (stage === "transition") return {
    eyebrow: `${turn} · NEXT`,
    title: "다음 턴을 준비합니다",
    detail: "이번 턴의 결과가 모두 반영되었습니다.",
    tone: "result",
  };
  return {
    eyebrow: `${turn} · RESULT`,
    title: describeCombatSequence(sequence, names),
    detail: "판정 완료",
    tone: "result",
  };
}

export function CombatStage(props: CombatStageProps) {
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const [line, setLine] = useState<Line | null>(null);
  const names = useMemo(
    () => Object.fromEntries(props.players.map((player) => [player.playerId, player.nickname])),
    [props.players],
  );
  const orderedPlayers = useMemo(
    () => [...props.players].sort((left, right) => {
      if (left.playerId === props.selfPlayerId) return 1;
      if (right.playerId === props.selfPlayerId) return -1;
      return left.seatNumber - right.seatNumber;
    }),
    [props.players, props.selfPlayerId],
  );
  const copy = presentation(props.sequence, props.stage, names, props.clashAttemptIndex);
  const selectedTargetId = props.selectionEnabled ? props.selectedPlayerId ?? null : null;
  const sourceId = props.isPlaying
    ? props.sequence?.actorId ?? null
    : selectedTargetId && selectedTargetId !== props.selfPlayerId
      ? props.selfPlayerId
      : null;
  const targetId = props.isPlaying
    ? props.sequence?.targetIds[0] ?? null
    : selectedTargetId;
  const showLine = Boolean(sourceId && targetId) && (
    (props.isPlaying && ["focus", "roll", "impact", "damage"].includes(props.stage))
    || (!props.isPlaying && props.selectionEnabled)
  );

  useLayoutEffect(() => {
    const update = () => {
      if (!showLine || !fieldRef.current || !sourceId || !targetId) {
        setLine(null);
        return;
      }
      const source = cardRefs.current.get(sourceId);
      const target = cardRefs.current.get(targetId);
      if (!source || !target) return setLine(null);
      const field = fieldRef.current.getBoundingClientRect();
      const from = source.getBoundingClientRect();
      const to = target.getBoundingClientRect();
      setLine({
        x1: from.left + from.width / 2 - field.left,
        y1: from.top + from.height / 2 - field.top,
        x2: to.left + to.width / 2 - field.left,
        y2: to.top + to.height / 2 - field.top,
      });
    };
    update();
    window.addEventListener("resize", update);
    const observer = new ResizeObserver(update);
    if (fieldRef.current) observer.observe(fieldRef.current);
    return () => {
      window.removeEventListener("resize", update);
      observer.disconnect();
    };
  }, [showLine, sourceId, targetId, props.players.length]);

  return (
    <section
      className={`combatStage combat-tone-${copy.tone}`}
      aria-live="polite"
      style={{
        "--playback-stage-duration": `${props.durationMs || getPlaybackDuration(1, props.speed)}ms`,
        "--playback-beat-duration": `${getPlaybackDuration(1, props.speed)}ms`,
      } as PlaybackStyle}
    >
      <header className="combatStageHeader">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h2>{copy.title}</h2>
          <p>{copy.detail}</p>
        </div>
        <div className="combatPlaybackControls">
          {props.isPlaying ? (
            <button type="button" onClick={props.onTogglePause}>
              {props.isPaused ? "계속" : "일시 정지"}
            </button>
          ) : <span>READY</span>}
          <select
            aria-label="재생 속도"
            value={props.speed}
            onChange={(event) => props.onSpeedChange(Number(event.target.value) as CombatPlaybackSpeed)}
          >
            <option value={1}>1×</option>
            <option value={1.5}>1.5×</option>
            <option value={2}>2×</option>
          </select>
          {props.isPlaying ? <button type="button" onClick={props.onSkip}>건너뛰기</button> : null}
        </div>
      </header>

      {props.sequence?.cards.length && props.stage !== "turn-intro" ? (
        <div className="combatReveals">
          {props.sequence.cards.map((card) => (
            <div key={card.cardInstanceId}>
              <span>{names[card.playerId]}</span>
              <strong>{card.cardName}</strong>
              {card.targetPlayerId ? <small>→ {names[card.targetPlayerId]}</small> : null}
            </div>
          ))}
        </div>
      ) : null}

      {props.sequence?.outcome === "CLASH" && !["turn-intro", "reveal"].includes(props.stage) ? (
        <ClashDisplay
          sequence={props.sequence}
          stage={props.stage}
          attemptIndex={props.clashAttemptIndex}
          names={names}
        />
      ) : null}

      {props.sequence?.outcome !== "CLASH" && props.sequence?.rolls.length && ["roll", "damage", "death", "summary", "transition"].includes(props.stage) ? (
        <div className="combatRolls">
          {props.sequence.rolls.map((roll, index) => (
            <div key={`${roll.playerId}-${roll.kind}-${index}`}>
              <span>{names[roll.playerId]}</span>
              <strong>{roll.total}</strong>
              <small>{roll.kind === "CLASH" ? `${roll.roll} + ${roll.bonus}` : `회피 ${roll.roll}+${roll.bonus} / 난이도 ${roll.difficulty}`}</small>
            </div>
          ))}
        </div>
      ) : null}

      {props.sequence && (
        props.sequence.reshuffles.length > 0
        || props.sequence.draws.length > 0
      ) && ["reshuffle-start", "reshuffle-shuffle", "reshuffle-complete", "draw"].includes(props.stage) ? (
        <div className={`deckPlayback deck-stage-${props.stage}`}>
          <div className="deckPlaybackPile grave"><span>무덤</span><strong>{props.stage === "reshuffle-start" ? props.sequence.reshuffles[0]?.discardCount ?? 0 : 0}</strong></div>
          <div className="deckShuffleCards" aria-hidden="true"><i /><i /><i /><i /></div>
          <div className="deckPlaybackArrow">→</div>
          <div className="deckPlaybackPile draw"><span>덱</span><strong>{props.stage === "draw" ? props.sequence.draws[0]?.drawPileCount ?? 0 : props.sequence.reshuffles[0]?.shuffledCount ?? 0}</strong></div>
        </div>
      ) : null}

      {showLine ? (
        <div className="combatMobileRoute">
          <strong>{names[sourceId!]}</strong><span>↓ 공격</span><strong>{names[targetId!]}</strong>
        </div>
      ) : null}

      <div className="combatCardField" ref={fieldRef}>
        {line ? (
          <svg className="combatDirectionLine" aria-hidden="true">
            <defs>
              <marker id="combat-arrow" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" />
              </marker>
            </defs>
            <line {...line} markerEnd="url(#combat-arrow)" />
          </svg>
        ) : null}
        <div className="onlinePlayers">
          {orderedPlayers.map((player) => {
            const shown = props.displayState[player.playerId] ?? player;
            const maxHp = shown.maxHp ?? player.maxHp;
            let actor = props.sequence?.actorIds.includes(player.playerId) ?? false;
            let target = props.sequence?.targetIds.includes(player.playerId) ?? false;
            const clash = props.sequence?.outcome === "CLASH" ? props.sequence.clash : null;
            if (clash) {
              if (["clash-first-roll", "clash-first-result"].includes(props.stage)) {
                actor = clash.participants[0].playerId === player.playerId;
                target = false;
              } else if (["clash-second-roll", "clash-second-result"].includes(props.stage)) {
                actor = clash.participants[1].playerId === player.playerId;
                target = false;
              } else if (["clash-winner", "impact", "damage", "death", "summary", "transition"].includes(props.stage)) {
                actor = props.sequence?.winnerId === player.playerId;
                target = props.sequence?.loserId === player.playerId;
              } else {
                actor = clash.participants.some((entry) => entry.playerId === player.playerId);
                target = false;
              }
            }
            const damage = props.sequence?.damages.find((entry) => entry.playerId === player.playerId);
            const heal = props.sequence?.heals.find((entry) => entry.playerId === player.playerId);
            const hit = Boolean(damage) && ["impact", "damage"].includes(props.stage);
            const dying = props.stage === "death" && props.sequence?.deathPlayerIds.includes(player.playerId);
            const relevant = actor || target || Boolean(damage) || Boolean(heal);
            const character = player.characterId ? CHARACTER_CATALOG[player.characterId] : null;
            return (
              <button
                type="button"
                key={player.playerId}
                ref={(node) => {
                  if (node) cardRefs.current.set(player.playerId, node);
                  else cardRefs.current.delete(player.playerId);
                }}
                className={[
                  "onlinePlayerCard",
                  player.playerId === props.selfPlayerId ? "self" : "",
                  props.selectedPlayerId === player.playerId ? "player-selection-active" : "",
                  props.selectionEnabled && shown.alive ? "player-selectable" : "",
                  !shown.alive ? "dead" : "",
                  props.isPlaying && !relevant ? "combat-inactive" : "",
                  actor ? "combat-actor-active" : "",
                  target ? "combat-target-active" : "",
                  props.stage === "clash-winner" && props.sequence?.winnerId === player.playerId ? "combat-clash-winner" : "",
                  props.stage === "clash-winner" && props.sequence?.loserId === player.playerId ? "combat-clash-loser" : "",
                  hit ? "combat-hit-shake" : "",
                  dying ? "combat-death" : "",
                  props.sequence?.outcome === "EVADE_SUCCESS" && target ? "combat-dodge" : "",
                ].filter(Boolean).join(" ")}
                disabled={!props.selectionEnabled || !shown.alive || props.isPlaying}
                aria-pressed={props.selectedPlayerId === player.playerId}
                onClick={() => props.onPlayerSelect?.(player.playerId)}
              >
                <div className="onlinePlayerHead">
                  <span className="seatBadge">{player.seatNumber}</span>
                  <div>
                    <h3>{player.nickname}</h3>
                    <small>{character?.name ?? "미선택"} · {player.playerId === props.selfPlayerId ? "YOU" : player.playerId === props.hostPlayerId ? "HOST" : "PLAYER"}</small>
                  </div>
                  <b>{player.connected ? "●" : "○"}</b>
                </div>
                <div className="combatStatusBadges">
                  {props.statuses.defending.includes(player.playerId) ? <span>🛡 방어</span> : null}
                  {props.statuses.evading.includes(player.playerId) ? <span>↝ 회피</span> : null}
                  {props.statuses.countering.includes(player.playerId) ? <span>↩ 반격</span> : null}
                </div>
                <div className="onlineHp">
                  <div><span>HP</span><strong>{formatHp(shown.hp)}<small>/{formatHp(maxHp)}</small></strong></div>
                  <div className="hpTrack"><span style={{ width: `${Math.max(0, shown.hp / maxHp * 100)}%` }} /></div>
                </div>
                <div className="submissionFlag">
                  <span>{player.usedCardCount === null ? "ACTION" : "USED"}</span>
                  <strong>{player.usedCardCount === null ? (player.submitted ? "LOCKED" : "HIDDEN") : `${player.usedCardCount} CARD`}</strong>
                </div>
                <div className="opponentDeckCounts" aria-label={`${player.nickname} 카드 수`}>
                  <span>손패 {player.handCount}</span>
                  <span>덱 {player.drawPileCount}</span>
                  <span>무덤 {player.discardPileCount}</span>
                  <span>전체 {player.totalDeckCount}</span>
                </div>
                {(props.reservationLabels?.[player.playerId]?.length ?? 0) > 0 ? (
                  <div className="privateReservationBadge">
                    {props.reservationLabels![player.playerId]!.map((label) => <span key={label}>내 선택 · {label}</span>)}
                  </div>
                ) : null}
                {hit ? <i className="combatImpactBurst" /> : null}
                {damage && props.stage === "damage" ? (
                  <div className="combat-damage-float">
                    {damage.source === "EVADE_FAILURE" ? <small>회피 실패!</small> : null}
                    {damage.source === "COUNTER" ? <small>반격!</small> : null}
                    <strong>-{formatHp(damage.damage)}</strong>
                    <span>HP {formatHp(damage.previousHp)} → {formatHp(damage.remainingHp)}</span>
                  </div>
                ) : null}
                {heal && props.stage === "damage" ? (
                  <div className="combat-heal-float"><strong>+{formatHp(heal.amount)}</strong></div>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
