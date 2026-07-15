"use client";

import type { PlayerGameView } from "@blind-turn/shared";

const LOCATION_LABEL = {
  HAND: "손패",
  DRAW_PILE: "덱",
  DISCARD_PILE: "무덤",
} as const;

export function DeckRemovalModal(props: {
  view: PlayerGameView;
  onToggleCard: (instanceId: string) => void;
  onConfirm: () => void;
  onOpenDeck: () => void;
}) {
  const selected = new Set(props.view.selectedRemovalInstanceIds);
  const required = props.view.requiredRemovalCount;
  return (
    <div className="choiceOverlay deckTrimOverlay" role="dialog" aria-modal="true" aria-label="덱 정리">
      <section className="deckTrimModal">
        <header>
          <div><p className="eyebrow">DECK LIMIT {props.view.maxDeckSize}</p><h2>덱 최대 크기를 초과했습니다</h2></div>
          <button type="button" onClick={props.onOpenDeck}>현재 덱 보기</button>
        </header>
        {props.view.deckRemovalConfirmed ? (
          <div className="rewardWaiting"><p>덱 정리 완료</p><h3>다른 플레이어를 기다리는 중...</h3></div>
        ) : (
          <>
            <div className="deckTrimSummary">
              <span>현재 덱 <b>{props.view.totalDeckCount} / {props.view.maxDeckSize}</b></span>
              <span>기존 카드 <b>{required}장을 제거하세요</b></span>
              <strong>선택 {selected.size} / {required}</strong>
            </div>
            <div className="deckTrimGrid">
              {props.view.deckRemovalCards.map((card) => {
                const isSelected = selected.has(card.instanceId);
                const totalOwned = props.view.myDeckSummary.find(
                  (summary) => summary.cardId === card.cardId,
                )?.totalCount ?? 1;
                return (
                  <button
                    type="button"
                    key={card.instanceId}
                    className={`deckTrimCard card-${card.definition.category.toLowerCase()} ${isSelected ? "selected" : ""}`}
                    disabled={!card.removable}
                    onClick={() => props.onToggleCard(card.instanceId)}
                    aria-pressed={isSelected}
                  >
                    <span>{card.definition.classId} · {card.definition.category}</span>
                    <h3>{card.definition.name}</h3>
                    <p>{card.definition.description}</p>
                    <small>현재 위치 · {LOCATION_LABEL[card.location]} · 총 {totalOwned}장</small>
                    {card.newlyAdded ? <em>이번 성장에서 획득한 카드는 제거할 수 없습니다.</em> : isSelected ? <em>제거 대상으로 선택됨</em> : null}
                  </button>
                );
              })}
            </div>
            <div className="deckTrimConfirm">
              <p>영구 제거된 카드는 무덤으로 가지 않으며 다시 섞이지 않습니다.</p>
              <button type="button" className="primaryButton" disabled={selected.size !== required} onClick={props.onConfirm}>선택한 카드 {required}장 영구 제거</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
