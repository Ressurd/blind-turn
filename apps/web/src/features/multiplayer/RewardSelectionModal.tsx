"use client";

import {
  MAX_COPIES_PER_CARD_ID,
  type CardDefinition,
  type PlayerGameView,
} from "@blind-turn/shared";

const TARGET_LABEL: Record<CardDefinition["targetType"], string> = {
  NONE: "대상 없음",
  SELF: "자신",
  ENEMY: "상대 1명",
};

export function RewardSelectionModal(props: {
  view: PlayerGameView;
  selectedCardId: string | null;
  onSelectCard: (cardId: string) => void;
  onConfirm: (cardId: string) => void;
  onOpenDeck: () => void;
}) {
  const selected = props.view.rewardOptions.find((card) => card.id === props.selectedCardId) ?? null;
  const confirmed = props.view.selectedReward;
  const status = props.view.rewardSelectionStatus;
  return (
    <div className="rewardOverlay" role="dialog" aria-modal="true" aria-label="새로운 카드 선택">
      <section className="rewardSelectionModal">
        <header>
          <div><p className="eyebrow">ROUND {props.view.roundNumber} · GROWTH</p><h2>새로운 카드를 선택하세요</h2></div>
          <div><span>남은 선택 시간은 상단 타이머에서 확인하세요</span><button type="button" onClick={props.onOpenDeck}>현재 덱 보기</button></div>
        </header>
        {confirmed ? (
          <div className="rewardWaiting">
            <p>선택 완료</p><h3>{confirmed.name}</h3><span>다른 플레이어를 기다리는 중</span>
            <strong>{status?.selectedPlayerCount ?? 1} / {status?.totalPlayerCount ?? 1} 완료</strong>
          </div>
        ) : (
          <>
            <div className="rewardStatusLine">
              <span>직업 카드 2장 · 공용 카드 1장</span>
              <strong>{status?.selectedPlayerCount ?? 0} / {status?.totalPlayerCount ?? 0} 완료</strong>
            </div>
            <div className="rewardCardRail">
              {props.view.rewardOptions.map((definition) => {
                const owned = props.view.myDeckSummary.find((summary) => summary.cardId === definition.id)?.totalCount ?? 0;
                return (
                  <button
                    type="button"
                    className={`rewardChoiceCard card-${definition.category.toLowerCase()} ${selected?.id === definition.id ? "selected" : ""}`}
                    key={definition.id}
                    onClick={() => props.onSelectCard(definition.id)}
                  >
                    <span>{definition.classId === "COMMON" ? "공용 카드" : "직업 카드"}</span>
                    <h3>{definition.name}</h3>
                    <dl><div><dt>카테고리</dt><dd>{definition.category}</dd></div><div><dt>대상</dt><dd>{TARGET_LABEL[definition.targetType]}</dd></div></dl>
                    <p>{definition.description}</p>
                    <small>현재 {owned}장 / 최대 {MAX_COPIES_PER_CARD_ID}장</small>
                  </button>
                );
              })}
            </div>
            <div className="rewardConfirmArea">
              <div>{selected ? <><span>선택한 카드</span><strong>{selected.name}</strong><p>{selected.description}</p></> : <p>카드를 선택하면 상세 내용을 확인할 수 있습니다.</p>}</div>
              <button type="button" className="primaryButton" disabled={!selected} onClick={() => selected && props.onConfirm(selected.id)}>이 카드 선택</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
