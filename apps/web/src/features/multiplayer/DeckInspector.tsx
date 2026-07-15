"use client";

import {
  MAX_COPIES_PER_CARD_ID,
  type CardDefinition,
  type PlayerGameView,
  type PrivateDeckCardSummary,
} from "@blind-turn/shared";

export type DeckInspectorMode = "hand" | "draw" | "discard" | "all";

const MODE_COPY: Record<DeckInspectorMode, { eyebrow: string; title: string; description: string }> = {
  hand: { eyebrow: "PRIVATE HAND", title: "손패", description: "현재 손에 있는 카드와 예약 상태입니다." },
  draw: { eyebrow: "PRIVATE DRAW PILE", title: "남은 덱", description: "카드 종류와 수량만 표시됩니다. 드로우 순서는 알 수 없습니다." },
  discard: { eyebrow: "PRIVATE GRAVE", title: "무덤 · 버린 카드", description: "사용하거나 버린 카드의 현재 구성입니다." },
  all: { eyebrow: "FULL DECK", title: "전체 덱", description: "손패·덱·무덤·예약 중인 카드를 위치별로 합산합니다." },
};

const TARGET_LABEL: Record<CardDefinition["targetType"], string> = {
  NONE: "대상 없음",
  SELF: "자신",
  ENEMY: "상대 1명",
};

function SummaryCard({ summary, mode }: { summary: PrivateDeckCardSummary; mode: DeckInspectorMode }) {
  const count = mode === "draw"
    ? summary.drawPileCount
    : mode === "discard"
      ? summary.discardPileCount
      : summary.totalCount;
  return (
    <article className={`deckInspectCard card-${summary.definition.category.toLowerCase()}`}>
      <div><span>{summary.definition.classId} · {summary.definition.category}</span><b>×{count}</b></div>
      <h3>{summary.definition.name}</h3>
      <p>{summary.definition.description}</p>
      <small>대상 · {TARGET_LABEL[summary.definition.targetType]}</small>
      {mode === "all" ? (
        <ul>
          <li>손패 {summary.handCount}</li>
          <li>덱 {summary.drawPileCount}</li>
          <li>무덤 {summary.discardPileCount}</li>
          <li>예약 {summary.queuedCount}</li>
        </ul>
      ) : null}
    </article>
  );
}

export function DeckInspector(props: {
  view: PlayerGameView;
  mode: DeckInspectorMode;
  onModeChange: (mode: DeckInspectorMode) => void;
  onRequestClose: () => void;
}) {
  const copy = MODE_COPY[props.mode];
  const names = Object.fromEntries(props.view.players.map((player) => [player.playerId, player.nickname]));
  const summaries = props.mode === "draw"
    ? props.view.myDrawPileSummary
    : props.mode === "discard"
      ? props.view.myDeckSummary.filter((summary) => summary.discardPileCount > 0)
      : props.view.myDeckSummary;

  return (
    <div
      className="choiceOverlay deckInspectorOverlay"
      role="dialog"
      aria-modal="true"
      aria-label={copy.title}
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onRequestClose();
      }}
    >
      <section className="deckInspector" onClick={(event) => event.stopPropagation()}>
        <header>
          <div><p className="eyebrow">{copy.eyebrow}</p><h2>{copy.title}</h2><p>{copy.description}</p></div>
          <button
            type="button"
            onClick={props.onRequestClose}
            aria-label="덱 조회 닫기"
          >닫기</button>
        </header>
        <nav aria-label="카드 위치">
          {(["hand", "draw", "discard", "all"] as const).map((mode) => (
            <button type="button" key={mode} className={props.mode === mode ? "selected" : ""} onClick={() => props.onModeChange(mode)}>
              {MODE_COPY[mode].title}
            </button>
          ))}
        </nav>
        <div className="deckInspectorTotals">
          <span>손패 <b>{props.view.myHand.length} / 5</b></span>
          <span>덱 <b>{props.view.drawPileCount}장</b></span>
          <span>무덤 <b>{props.view.discardPileCount}장</b></span>
          <span>전체 덱 <b>{props.view.totalDeckCount} / {props.view.maxDeckSize}</b></span>
        </div>
        {props.mode === "hand" ? (
          <div className="deckInspectGrid">
            {props.view.myHand.map((card) => {
              const queued = props.view.myQueuedCards.find((entry) => entry.cardInstanceId === card.instanceId);
              return (
                <article className={`deckInspectCard card-${card.definition.category.toLowerCase()} ${queued ? "reserved" : ""}`} key={card.instanceId}>
                  <div><span>{card.definition.classId} · {card.definition.category}</span><b>{queued ? "예약됨" : "사용 가능"}</b></div>
                  <h3>{card.definition.name}</h3><p>{card.definition.description}</p>
                  <small>대상 · {TARGET_LABEL[card.definition.targetType]}</small>
                  {queued ? <em>{queued.order + 1}단계{queued.targetPlayerId ? ` → ${names[queued.targetPlayerId]}` : ""}</em> : null}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="deckInspectGrid">
            {summaries.length > 0
              ? summaries.map((summary) => <SummaryCard key={summary.cardId} summary={summary} mode={props.mode} />)
              : <p className="emptyText">이 위치에는 카드가 없습니다.</p>}
          </div>
        )}
        <footer>동일 카드 최대 {MAX_COPIES_PER_CARD_ID}장 · 카드 ID와 정확한 드로우 순서는 다른 플레이어에게 공개되지 않습니다.</footer>
      </section>
    </div>
  );
}
