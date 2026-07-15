import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import {
  HP_SCALE,
  getCardDefinition,
  type PlayerGameView,
} from "@blind-turn/shared";
import { DeckInspector } from "../src/features/multiplayer/DeckInspector";
import { DeckRemovalModal } from "../src/features/multiplayer/DeckRemovalModal";
import { RewardSelectionModal } from "../src/features/multiplayer/RewardSelectionModal";
import { CombatStage } from "../src/features/multiplayer/CombatStage";
import { buildCombatSequences } from "../src/features/multiplayer/combat-sequence";
import {
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
      { playerId: "p1", nickname: "나", seatNumber: 1, characterId: "DUELIST", connected: true, ready: true, alive: true, hp: 60, maxHp: 60, handCount: 2, maxHandSize: 5, drawPileCount: 4, discardPileCount: 2, totalDeckCount: 10, permanentlyRemovedCount: 0, submitted: false, usedCardCount: null },
      { playerId: "p2", nickname: "상대", seatNumber: 2, characterId: "GUARDIAN", connected: true, ready: true, alive: true, hp: 70, maxHp: 70, handCount: 3, maxHandSize: 5, drawPileCount: 3, discardPileCount: 2, totalDeckCount: 10, permanentlyRemovedCount: 0, submitted: false, usedCardCount: null },
    ],
    roundNumber: 3,
    myCharacterId: "DUELIST",
    myHand: [
      { instanceId: "quick-1", cardId: quick.id, definition: quick },
      { instanceId: "guard-1", cardId: guard.id, definition: guard },
    ],
    myDiscardPile: [],
    myPermanentlyRemovedCards: [],
    myDrawPileSummary: [{ cardId: quick.id, definition: quick, totalCount: 2, handCount: 0, drawPileCount: 1, discardPileCount: 0, selectedCount: 1, removedCount: 0 }],
    myDeckSummary: [
      { cardId: quick.id, definition: quick, totalCount: 2, handCount: 0, drawPileCount: 1, discardPileCount: 0, selectedCount: 1, removedCount: 0 },
      { cardId: guard.id, definition: guard, totalCount: 2, handCount: 1, drawPileCount: 0, discardPileCount: 1, selectedCount: 0, removedCount: 0 },
    ],
    mySelectedAction: { cardInstanceId: "quick-1", targetPlayerId: "p2", additionalSelection: null },
    myConfirmed: false,
    drawPileCount: 4,
    discardPileCount: 2,
    totalDeckCount: 10,
    permanentlyRemovedCount: 0,
    maxDeckSize: 15,
    rewardOptions: [
      getCardDefinition("DUELIST_BLADE"),
      getCardDefinition("DUELIST_FLASH_THRUST"),
      getCardDefinition("COMMON_FIRST_AID"),
    ],
    rewardSelectionState: null,
    selectedRewards: [getCardDefinition("DUELIST_BLADE"), getCardDefinition("COMMON_FIRST_AID")],
    rewardSelectionConfirmed: false,
    requiredRewardSelectionCount: 2,
    rewardSelectionStatus: { selectedPlayerCount: 0, totalPlayerCount: 2 },
    deckRemovalCards: [],
    requiredRemovalCount: 0,
    selectedRemovalInstanceIds: [],
    deckRemovalConfirmed: false,
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
        onToggleCard: selectCard,
        onConfirm: confirm,
        onOpenDeck: vi.fn(),
      }),
    );
    expect(html.match(/rewardChoiceCard/g)).toHaveLength(3);
    expect(html).toContain("카드 3장 중 2장을 선택하세요");
    expect(html).toContain("선택한 카드 2장 확정");
    expect(html).toContain("현재 덱 보기");
    expect(selectCard).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("renders four Tactician choices while still requiring exactly two", () => {
    const view = viewFixture();
    view.myCharacterId = "TACTICIAN";
    view.rewardOptions = [
      getCardDefinition("TACTICIAN_RECYCLE"),
      getCardDefinition("TACTICIAN_SWAP"),
      getCardDefinition("TACTICIAN_SIFT"),
      getCardDefinition("COMMON_FIRST_AID"),
    ];
    view.selectedRewards = [];
    const html = renderToStaticMarkup(createElement(RewardSelectionModal, {
      view,
      onToggleCard: vi.fn(),
      onConfirm: vi.fn(),
      onOpenDeck: vi.fn(),
    }));
    expect(html.match(/rewardChoiceCard/g)).toHaveLength(4);
    expect(html).toContain("전술가의 선택");
    expect(html).toContain("카드 4장 중 2장을 선택하세요");
    expect(html).toContain("현재 선택 0 / 2");
  });

  it("renders draw aggregates without instance ids and includes the selected card location", () => {
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
    expect(allHtml).toContain("선택");
    expect(allHtml).toContain("전체 덱");
  });

  it("renders exact removal count and disables cards from the current reward", () => {
    const view = viewFixture();
    view.phase = "SELECTING_DECK_REMOVAL";
    view.totalDeckCount = 16;
    view.requiredRemovalCount = 1;
    view.deckRemovalCards = [
      { ...view.myHand[0]!, location: "HAND", newlyAdded: false, removable: true },
      { ...view.myHand[1]!, location: "DRAW_PILE", newlyAdded: true, removable: false },
    ];
    const html = renderToStaticMarkup(createElement(DeckRemovalModal, {
      view,
      onToggleCard: vi.fn(),
      onConfirm: vi.fn(),
      onOpenDeck: vi.fn(),
    }));
    expect(html).toContain("현재 덱 <b>16 / 15</b>");
    expect(html).toContain("기존 카드 <b>1장을 제거하세요</b>");
    expect(html).toContain("이번 성장에서 획득한 카드는 제거할 수 없습니다.");
    expect(html).toContain("disabled");
  });

  it("uses one controller duration for simultaneous card reveal CSS", () => {
    const view = viewFixture();
    const html = renderToStaticMarkup(createElement(CombatStage, {
      players: view.players,
      selfPlayerId: view.selfPlayerId,
      hostPlayerId: view.hostPlayerId,
      displayState: Object.fromEntries(view.players.map((player) => [player.playerId, player])),
      sequence: {
        id: "turn",
        type: "TURN",
        roundNumber: 1,
        actorId: "p1",
        actorIds: ["p1", "p2"],
        targetIds: ["p2"],
        outcome: "ATTACK",
        cards: view.myHand.map((card, index) => ({
          playerId: index === 0 ? "p1" : "p2",
          cardInstanceId: card.instanceId,
          cardId: card.cardId,
          cardName: card.definition.name,
        })),
        rolls: [], damages: [], heals: [], reshuffles: [], draws: [], deathPlayerIds: [],
        winnerId: null, loserId: null, counterActorId: null,
        originalEventRange: { start: 0, end: 0 }, events: [],
      },
      stage: "reveal",
      clashAttemptIndex: 0,
      statuses: { defending: [], evading: [], countering: [] },
      isPlaying: true,
      isPaused: false,
      speed: 1,
      durationMs: 600,
      onTogglePause: vi.fn(), onSpeedChange: vi.fn(), onSkip: vi.fn(),
    }));
    expect(html).toContain("--playback-stage-duration:600ms");
    expect(html).toContain("--playback-beat-duration:750ms");
    expect(html).not.toContain("animation-delay");
  });

  it("shows clash rolls sequentially and separates roll, bonuses, and final value", () => {
    const view = viewFixture();
    const sequence = buildCombatSequences([
      { type: "TURN_RESOLUTION_STARTED", roundNumber: 1 },
      { type: "CARD_REVEALED", roundNumber: 1, playerId: "p1", cardInstanceId: "q", cardId: "BASE_QUICK_STRIKE", targetPlayerId: "p2" },
      { type: "CARD_REVEALED", roundNumber: 1, playerId: "p2", cardInstanceId: "h", cardId: "BASE_HEAVY_STRIKE", targetPlayerId: "p1" },
      { type: "CLASH_STARTED", playerIds: ["p1", "p2"], cardIds: ["BASE_QUICK_STRIKE", "BASE_HEAVY_STRIKE"] },
      { type: "CLASH_ROLLED", playerId: "p1", roll: 5, bonus: 3, total: 8 },
      { type: "CLASH_ROLLED", playerId: "p2", roll: 6, bonus: 0, total: 6 },
      { type: "CLASH_RESOLVED", winnerId: "p1", loserId: "p2" },
      { type: "DAMAGE_APPLIED", playerId: "p2", damage: 3 * HP_SCALE, remainingHp: 27 * HP_SCALE, source: "ATTACK" },
      { type: "TURN_RESOLUTION_FINISHED", roundNumber: 1 },
    ])[0]!;
    const baseProps = {
      players: view.players,
      selfPlayerId: view.selfPlayerId,
      hostPlayerId: view.hostPlayerId,
      displayState: Object.fromEntries(view.players.map((player) => [player.playerId, player])),
      sequence,
      clashAttemptIndex: 0,
      statuses: { defending: [], evading: [], countering: [] },
      isPlaying: true,
      isPaused: false,
      speed: 1 as const,
      durationMs: 600,
      onTogglePause: vi.fn(), onSpeedChange: vi.fn(), onSkip: vi.fn(),
    };
    const firstResult = renderToStaticMarkup(createElement(CombatStage, {
      ...baseProps,
      stage: "clash-first-result",
    }));
    expect(firstResult).toContain("나 · 주사위 5");
    expect(firstResult).toContain("clashFixedNumber\">?");
    expect(firstResult).not.toContain("승리!");

    const modifiers = renderToStaticMarkup(createElement(CombatStage, {
      ...baseProps,
      stage: "clash-modifiers",
    }));
    expect(modifiers).toContain("카드 보정");
    expect(modifiers).toContain("캐릭터 보정");
    expect(modifiers).toContain("+2");
    expect(modifiers).toContain("+1");
    expect(modifiers).toContain("최종");

    const damage = renderToStaticMarkup(createElement(CombatStage, {
      ...baseProps,
      stage: "damage",
      durationMs: 1_500,
    }));
    expect(damage).toContain("clashDisplay");
    expect(damage).toContain("합 승리");
    expect(damage).toContain("합 패배");
    expect(damage).not.toContain("다음 행동");
  });
});

describe("target-centered action reservation", () => {
  it("filters self and enemy actions, permits changing the selection, and blocks dead targets", () => {
    const view = viewFixture();
    view.phase = "SELECTING_CARDS";
    view.mySelectedAction = null;
    const enemyCards = getTargetActionCandidates(view, "p2");
    const selfCards = getTargetActionCandidates(view, "p1");
    expect(enemyCards.map((card) => card.cardId)).toEqual(["BASE_QUICK_STRIKE"]);
    expect(selfCards.map((card) => card.cardId)).toEqual(["BASE_GUARD"]);

    view.mySelectedAction = { cardInstanceId: "quick-1", targetPlayerId: "p2", additionalSelection: null };
    expect(getTargetActionCandidates(view, "p2").map((card) => card.cardId)).toEqual(["BASE_QUICK_STRIKE"]);
    expect(getReservationLabels(view).p2).toEqual(["선택 · 속공"]);

    view.players[1]!.alive = false;
    expect(getTargetActionCandidates(view, "p2")).toEqual([]);
  });

  it("uses one selected action with PASS and no queue editor", () => {
    const source = readFileSync(
      new URL("../src/features/multiplayer/MultiplayerGame.tsx", import.meta.url),
      "utf8",
    );
    expect(source).not.toContain("stagePicker");
    expect(source).not.toContain("showQueueEditor");
    expect(source).not.toContain("myQueuedCards");
    expect(source).toContain("이번 턴에 사용할 한 장으로 선택합니다.");
    expect(source).toContain("game:select-action");
    expect(source).toContain("패스");
  });
});
