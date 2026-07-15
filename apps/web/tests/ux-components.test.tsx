import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  getCardDefinition,
  type PlayerGameView,
} from "@blind-turn/shared";
import { DeckInspector } from "../src/features/multiplayer/DeckInspector";
import { RewardSelectionModal } from "../src/features/multiplayer/RewardSelectionModal";
import {
  firstFreeActionStage,
  getReservationLabels,
  getTargetActionCandidates,
} from "../src/features/multiplayer/action-reservation";

function viewFixture(): PlayerGameView {
  const quick = getCardDefinition("BASE_QUICK_STRIKE");
  const guard = getCardDefinition("BASE_GUARD");
  return {
    roomCode: "ABC234",
    hostPlayerId: "p1",
    selfPlayerId: "p1",
    phase: "SELECTING_REWARD",
    players: [
      { playerId: "p1", nickname: "나", seatNumber: 1, characterId: "DUELIST", connected: true, ready: true, alive: true, hp: 60, maxHp: 60, handCount: 2, maxHandSize: 5, drawPileCount: 4, discardPileCount: 2, totalDeckCount: 8, submitted: false, usedCardCount: null },
      { playerId: "p2", nickname: "상대", seatNumber: 2, characterId: "GUARDIAN", connected: true, ready: true, alive: true, hp: 70, maxHp: 70, handCount: 3, maxHandSize: 5, drawPileCount: 3, discardPileCount: 2, totalDeckCount: 8, submitted: false, usedCardCount: null },
    ],
    roundNumber: 3,
    myCharacterId: "DUELIST",
    myHand: [
      { instanceId: "quick-1", cardId: quick.id, definition: quick },
      { instanceId: "guard-1", cardId: guard.id, definition: guard },
    ],
    myDiscardPile: [],
    myDrawPileSummary: [{ cardId: quick.id, definition: quick, totalCount: 2, handCount: 0, drawPileCount: 1, discardPileCount: 0, queuedCount: 1 }],
    myDeckSummary: [
      { cardId: quick.id, definition: quick, totalCount: 2, handCount: 0, drawPileCount: 1, discardPileCount: 0, queuedCount: 1 },
      { cardId: guard.id, definition: guard, totalCount: 2, handCount: 1, drawPileCount: 0, discardPileCount: 1, queuedCount: 0 },
    ],
    myQueuedCards: [{ cardInstanceId: "quick-1", order: 1, targetPlayerId: "p2", additionalSelection: null }],
    myConfirmed: false,
    drawPileCount: 4,
    discardPileCount: 2,
    totalDeckCount: 8,
    maxDeckSize: 10,
    initialHandOptions: [],
    rewardOptions: [
      getCardDefinition("DUELIST_BLADE"),
      getCardDefinition("DUELIST_FLASH_THRUST"),
      getCardDefinition("COMMON_FIRST_AID"),
    ],
    selectedReward: null,
    rewardSelectionStatus: { selectedPlayerCount: 0, totalPlayerCount: 2 },
    deckRemovalCandidates: [],
    actionDeadlineAt: null,
    rewardDeadlineAt: Date.now() + 30_000,
    result: null,
    totalRounds: 3,
    fatalError: null,
    chatHistory: [],
    pendingRoundPlayback: null,
  };
}

describe("reward and deck UX", () => {
  it("renders three reward cards and requires a separate confirmation button", () => {
    const view = viewFixture();
    const selectCard = vi.fn();
    const confirm = vi.fn();
    const html = renderToStaticMarkup(
      createElement(RewardSelectionModal, {
        view,
        selectedCardId: "DUELIST_BLADE",
        onSelectCard: selectCard,
        onConfirm: confirm,
        onOpenDeck: vi.fn(),
      }),
    );
    expect(html.match(/rewardChoiceCard/g)).toHaveLength(3);
    expect(html).toContain("새로운 카드를 선택하세요");
    expect(html).toContain("이 카드 선택");
    expect(html).toContain("현재 덱 보기");
    expect(selectCard).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("renders draw aggregates without instance ids and includes queued cards in full-deck locations", () => {
    const view = viewFixture();
    const drawHtml = renderToStaticMarkup(
      createElement(DeckInspector, {
        view,
        mode: "draw",
        onModeChange: vi.fn(),
        onRequestClose: vi.fn(),
      }),
    );
    expect(drawHtml).toContain("드로우 순서는 알 수 없습니다");
    expect(drawHtml).not.toContain("quick-1");
    const allHtml = renderToStaticMarkup(
      createElement(DeckInspector, {
        view,
        mode: "all",
        onModeChange: vi.fn(),
        onRequestClose: vi.fn(),
      }),
    );
    expect(allHtml).toContain("예약");
    expect(allHtml).toContain("전체 덱");
  });
});

describe("target-centered action reservation", () => {
  it("filters self and enemy actions, excludes reservations, and blocks dead targets", () => {
    const view = viewFixture();
    view.phase = "SELECTING_CARDS";
    view.myQueuedCards = [];
    const enemyCards = getTargetActionCandidates(view, "p2");
    const selfCards = getTargetActionCandidates(view, "p1");
    expect(enemyCards.map((card) => card.cardId)).toEqual(["BASE_QUICK_STRIKE"]);
    expect(selfCards.map((card) => card.cardId)).toEqual(["BASE_GUARD"]);

    view.myQueuedCards = [{ cardInstanceId: "quick-1", order: 1, targetPlayerId: "p2", additionalSelection: null }];
    expect(getTargetActionCandidates(view, "p2")).toEqual([]);
    expect(firstFreeActionStage(view)).toBe(0);
    expect(getReservationLabels(view).p2).toEqual(["2단계 · 속공"]);

    view.players[1]!.alive = false;
    expect(getTargetActionCandidates(view, "p2")).toEqual([]);
  });
});
