"use client";

import { CHARACTER_CATALOG, formatHp, type RoomPlayerView } from "@blind-turn/shared";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  describeCombatSequence,
  type CombatDisplayState,
  type CombatSequence,
} from "./combat-sequence";
import type {
  CombatPlaybackSpeed,
  CombatPlaybackStage,
  CombatStatusState,
} from "./use-combat-playback";

type CombatStageProps = {
  players: RoomPlayerView[];
  selfPlayerId: string;
  hostPlayerId: string;
  displayState: CombatDisplayState;
  sequence: CombatSequence | null;
  stage: CombatPlaybackStage;
  statuses: CombatStatusState;
  isPlaying: boolean;
  isPaused: boolean;
  speed: CombatPlaybackSpeed;
  onTogglePause: () => void;
  onSpeedChange: (speed: CombatPlaybackSpeed) => void;
  onSkip: () => void;
};

type Line = { x1: number; y1: number; x2: number; y2: number };

function presentation(
  sequence: CombatSequence | null,
  stage: CombatPlaybackStage,
  names: Record<string, string>,
): { eyebrow: string; title: string; detail: string; tone: string } {
  const name = (id: string | null | undefined) => id ? names[id] ?? "플레이어" : "플레이어";
  if (!sequence) return {
    eyebrow: "COMBAT STAGE",
    title: "카드를 선택하세요",
    detail: "라운드가 확정되면 각 단계의 카드가 여기서 동시에 공개됩니다.",
    tone: "idle",
  };
  if (sequence.type === "ROUND") return {
    eyebrow: `ROUND ${sequence.roundNumber}`,
    title: `${sequence.roundNumber}라운드 판정 시작`,
    detail: "1단계부터 최대 3단계까지 순서대로 처리합니다.",
    tone: "round",
  };
  if (sequence.type === "GAME_OVER") return {
    eyebrow: "BATTLE COMPLETE",
    title: sequence.winnerId ? `${name(sequence.winnerId)} 승리` : "무승부",
    detail: "최종 전투 결과가 확정되었습니다.",
    tone: "result",
  };
  const step = `${(sequence.stepIndex ?? 0) + 1}단계`;
  if (stage === "reveal") return {
    eyebrow: `${step} · CARD REVEAL`,
    title: sequence.cards.map((card) => `${name(card.playerId)} · ${card.cardName}`).join("  /  ") || "행동 취소",
    detail: "같은 단계의 행동은 동시에 판정됩니다.",
    tone: "action",
  };
  if (stage === "roll") {
    if (sequence.outcome === "COUNTER") return {
      eyebrow: `${step} · COUNTER`,
      title: "반격 발동!",
      detail: `${name(sequence.counterActorId)}의 반격이 공격 방향을 뒤집습니다.`,
      tone: "counter",
    };
    if (sequence.outcome === "CLASH") return {
      eyebrow: `${step} · CLASH`,
      title: `${name(sequence.winnerId)} 합 승리`,
      detail: "주사위 + 카드 보너스 + 캐릭터 보너스를 비교했습니다.",
      tone: "clash",
    };
    return {
      eyebrow: `${step} · EVADE CHECK`,
      title: sequence.outcome === "EVADE_FAILURE" ? "회피 실패!" : "회피 성공!",
      detail: "회피 총합과 공격 카드의 회피 난이도를 비교합니다.",
      tone: sequence.outcome === "EVADE_FAILURE" ? "danger" : "success",
    };
  }
  if (stage === "impact") return {
    eyebrow: `${step} · IMPACT`,
    title: sequence.outcome === "EVADE_SUCCESS" ? "공격을 피했습니다!" : "공격 적중!",
    detail: sequence.outcome === "COUNTER" ? "공격은 취소되고 반격 피해가 동시에 적용됩니다." : "피해 결과를 적용합니다.",
    tone: sequence.outcome === "EVADE_SUCCESS" ? "success" : "danger",
  };
  if (stage === "damage") {
    const damageText = sequence.damages.map((damage) =>
      `${name(damage.playerId)} -${formatHp(damage.damage)}`).join(" · ");
    const healText = sequence.heals.map((heal) =>
      `${name(heal.playerId)} +${formatHp(heal.amount)}`).join(" · ");
    return {
      eyebrow: `${step} · HP UPDATE`,
      title: damageText || healText,
      detail: sequence.damages.map((damage) =>
        `HP ${formatHp(damage.previousHp)} → ${formatHp(damage.remainingHp)}`).join("  /  "),
      tone: sequence.damages.length ? "damage" : "success",
    };
  }
  if (stage === "death") return {
    eyebrow: `${step} · PLAYER DOWN`,
    title: `${name(sequence.deathPlayerIds[0])}님이 쓰러졌습니다.`,
    detail: "다음 단계의 예약 행동은 취소됩니다.",
    tone: "death",
  };
  return {
    eyebrow: `${step} · RESULT`,
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
  const copy = presentation(props.sequence, props.stage, names);
  const sourceId = props.sequence?.actorId ?? null;
  const targetId = props.sequence?.targetIds[0] ?? null;
  const showLine = props.isPlaying
    && Boolean(sourceId && targetId)
    && ["reveal", "roll", "impact", "damage"].includes(props.stage);

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
    <section className={`combatStage combat-tone-${copy.tone}`} aria-live="polite">
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

      {props.sequence?.cards.length ? (
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

      {props.sequence?.rolls.length ? (
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
          {props.players.map((player) => {
            const shown = props.displayState[player.playerId] ?? player;
            const maxHp = shown.maxHp ?? player.maxHp;
            const actor = props.sequence?.actorIds.includes(player.playerId) ?? false;
            const target = props.sequence?.targetIds.includes(player.playerId) ?? false;
            const damage = props.sequence?.damages.find((entry) => entry.playerId === player.playerId);
            const heal = props.sequence?.heals.find((entry) => entry.playerId === player.playerId);
            const hit = Boolean(damage) && ["impact", "damage"].includes(props.stage);
            const dying = props.stage === "death" && props.sequence?.deathPlayerIds.includes(player.playerId);
            const relevant = actor || target || Boolean(damage) || Boolean(heal);
            const character = player.characterId ? CHARACTER_CATALOG[player.characterId] : null;
            return (
              <article
                key={player.playerId}
                ref={(node) => {
                  if (node) cardRefs.current.set(player.playerId, node);
                  else cardRefs.current.delete(player.playerId);
                }}
                className={[
                  "onlinePlayerCard",
                  player.playerId === props.selfPlayerId ? "self" : "",
                  !shown.alive ? "dead" : "",
                  props.isPlaying && !relevant ? "combat-inactive" : "",
                  actor ? "combat-actor-active" : "",
                  target ? "combat-target-active" : "",
                  hit ? "combat-hit-shake" : "",
                  dying ? "combat-death" : "",
                  props.sequence?.outcome === "EVADE_SUCCESS" && target ? "combat-dodge" : "",
                ].filter(Boolean).join(" ")}
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
                  <span>{player.usedCardCount === null ? "QUEUE" : "USED"}</span>
                  <strong>{player.usedCardCount === null ? (player.submitted ? "LOCKED" : "HIDDEN") : `${player.usedCardCount} CARD`}</strong>
                </div>
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
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
