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
  onToggleCard: (cardId: string) => void;
  onConfirm: () => void;
  onOpenDeck: () => void;
}) {
  const selectedIds = new Set(props.view.selectedRewards.map((card) => card.id));
  const confirmed = props.view.rewardSelectionConfirmed;
  const required = props.view.requiredRewardSelectionCount;
  const status = props.view.rewardSelectionStatus;
  return (
    <div className="rewardOverlay" role="dialog" aria-modal="true" aria-label="성장 카드 선택">
      <section className="rewardSelectionModal">
        <header>
          <div><p className="eyebrow">ROUND {props.view.roundNumber} · GROWTH</p><h2>카드 2장을 선택하세요</h2></div>
          <div><span>현재 선택 {props.view.selectedRewards.length} / {required} · 제한 시간 60초</span><button type="button" onClick={props.onOpenDeck}>현재 덱 보기</button></div>
        </header>
        {confirmed ? (
          <div className="rewardWaiting">
            <p>카드 선택 완료</p>
            <h3>{props.view.selectedRewards.map((card) => card.name).join(" · ")}</h3>
            <span>다른 플레이어를 기다리는 중...</span>
            <strong>{status?.selectedPlayerCount ?? 1} / {status?.totalPlayerCount ?? 1}명 완료</strong>
          </div>
        ) : (
          <>
            <div className="rewardStatusLine">
              <span>직업 카드 2장 · 공용 카드 1장</span>
              <strong>선택 {props.view.selectedRewards.length} / {required}</strong>
            </div>
            <div className="rewardCardRail">
              {props.view.rewardOptions.map((definition) => {
                const owned = props.view.myDeckSummary.find((summary) => summary.cardId === definition.id)?.totalCount ?? 0;
                const selected = selectedIds.has(definition.id);
                const forfeited = selectedIds.size === required && !selected;
                return (
                  <button
                    type="button"
                    className={`rewardChoiceCard card-${definition.category.toLowerCase()} ${selected ? "selected" : ""} ${forfeited ? "forfeited" : ""}`}
                    key={definition.id}
                    onClick={() => props.onToggleCard(definition.id)}
                    aria-pressed={selected}
                  >
                    <span>{definition.classId === "COMMON" ? "공용 카드" : "직업 카드"}</span>
                    <h3>{definition.name}</h3>
                    <dl><div><dt>카테고리</dt><dd>{definition.category}</dd></div><div><dt>대상</dt><dd>{TARGET_LABEL[definition.targetType]}</dd></div></dl>
                    <p>{definition.description}</p>
                    <small>현재 {owned}장 / 최대 {MAX_COPIES_PER_CARD_ID}장</small>
                    {selected ? <b className="rewardCardState">선택됨</b> : forfeited ? <b className="rewardCardState">이번에 포기</b> : null}
                  </button>
                );
              })}
            </div>
            <div className="rewardConfirmArea">
              <div>
                <span>선택한 카드</span>
                <strong>{props.view.selectedRewards.length > 0 ? props.view.selectedRewards.map((card) => card.name).join(" · ") : "아직 선택하지 않았습니다"}</strong>
                <p>확정 전에는 선택한 카드를 다시 눌러 자유롭게 변경할 수 있습니다.</p>
              </div>
              <button
                type="button"
                className="primaryButton"
                disabled={props.view.selectedRewards.length !== required}
                onClick={props.onConfirm}
              >선택한 카드 2장 확정</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
