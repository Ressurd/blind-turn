import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  createInitialPveBattleState,
  createPassPvePlans,
  getPvePlaybackEventDuration,
  getPveTimelineEntryPlaybackDuration,
  getPveTurnPlaybackDuration,
  getPveTurnPlaybackTimeoutMs,
  PVE_PLAYBACK_TIMINGS,
  resolvePveTurn,
} from "@blind-turn/shared";
import { PvePrototype } from "../src/features/pve-prototype/PvePrototype";
import {
  buildPlaybackTimelineItems,
} from "../src/features/pve-prototype/ActionTimeline";
import {
  reducePvePlayback,
  type PvePlaybackState,
} from "../src/features/pve-prototype/usePvePlayback";

describe("PvE prototype initial UI", () => {
  it("renders the 6x4 board, four fixed characters, and all boss intents", () => {
    const html = renderToStaticMarkup(createElement(PvePrototype));
    expect(html.match(/aria-label="타일 /g)).toHaveLength(24);
    expect(html).toContain("전사");
    expect(html).toContain("궁수");
    expect(html).toContain("마법사");
    expect(html).toContain("사제");
    expect(html).toContain("열 내려치기");
    expect(html).toContain("추적 마력탄");
    expect(html).toContain("대지 진동");
    expect(html).toContain("보스 행동 예고");
    expect(html.match(/aria-label="보스 점유 타일 /g)).toHaveLength(2);
    expect(html).toContain("위치 x=6 · y=1~2");
    expect(html).toContain("보스 영역");
    expect(html).toContain("예상 순서");
    expect(html).toContain("비트 1 / 3");
    expect(html).toContain("휩쓸기");
    expect(html).not.toContain("<img");
  });

  it("starts with twelve empty slots and a disabled simulation button", () => {
    const html = renderToStaticMarkup(createElement(PvePrototype));
    expect(html.match(/>비어 있음<\/strong>/g)).toHaveLength(12);
    expect(
      html.match(/aria-label="(?:전사|궁수|마법사|사제) [123]번 행동 비어 있음"/g),
    ).toHaveLength(12);
    expect(html).toContain("0 / 12");
    expect(html).toContain("시뮬레이션 시작");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>시뮬레이션 시작/);
  });
});

describe("PvE playback controller", () => {
  function createControllerState(): PvePlaybackState {
    return {
      resolution: null,
      displayState: createInitialPveBattleState(),
      eventIndex: -1,
      isPlaying: false,
    };
  }

  it("advances events in order and finishes on the engine final state", () => {
    const initialState = createInitialPveBattleState();
    const resolution = resolvePveTurn(initialState, createPassPvePlans());
    let state = reducePvePlayback(createControllerState(), {
      type: "START",
      resolution,
      initialState,
    });

    for (let index = 0; index < resolution.events.length; index += 1) {
      state = reducePvePlayback(state, { type: "ADVANCE" });
      expect(state.eventIndex).toBe(index);
      expect(state.displayState).toEqual(resolution.events[index]?.state);
    }
    expect(state.isPlaying).toBe(false);
    expect(state.displayState).toEqual(resolution.state);
  });

  it("blocks duplicate starts and reset clears every playback field", () => {
    const initialState = createInitialPveBattleState();
    const resolution = resolvePveTurn(initialState, createPassPvePlans());
    const started = reducePvePlayback(createControllerState(), {
      type: "START",
      resolution,
      initialState,
    });
    const duplicate = reducePvePlayback(started, {
      type: "START",
      resolution,
      initialState,
    });
    expect(duplicate).toBe(started);

    const reset = reducePvePlayback(started, { type: "RESET", initialState });
    expect(reset).toEqual({
      resolution: null,
      displayState: initialState,
      eventIndex: -1,
      isPlaying: false,
    });
  });

  it("keeps reduced motion playback finite without dropping results", () => {
    const initialState = createInitialPveBattleState();
    const resolution = resolvePveTurn(initialState, createPassPvePlans());
    expect(getPvePlaybackEventDuration(resolution, 0, true)).toBe(70);
    expect(getPvePlaybackEventDuration(resolution, 0)).toBe(800);

    let state = reducePvePlayback(createControllerState(), {
      type: "START",
      resolution,
      initialState,
    });
    while (state.isPlaying) state = reducePvePlayback(state, { type: "ADVANCE" });
    expect(state.displayState).toEqual(resolution.state);
  });

  it("budgets normal, failed, pass, and boss actions as complete playback groups", () => {
    const plans = createPassPvePlans();
    plans.WARRIOR[0] = { actionId: "WARRIOR_DEFEND" };
    const resolution = resolvePveTurn(createInitialPveBattleState(), plans);
    const normal = resolution.timeline.find((entry) =>
      entry.actorId === "WARRIOR" && entry.beat === 1
    )!;
    const pass = resolution.timeline.find((entry) => entry.actionId === "PASS")!;
    const boss = resolution.timeline.find((entry) => entry.actorType === "BOSS")!;
    const sumEntry = (start: number, end: number) => {
      let total = 0;
      for (let index = start; index <= end; index += 1) {
        total += getPvePlaybackEventDuration(resolution, index);
      }
      return total;
    };

    expect(getPveTimelineEntryPlaybackDuration(normal)).toBe(3_500);
    expect(sumEntry(normal.startEventIndex, normal.endEventIndex)).toBe(3_500);
    expect(getPveTimelineEntryPlaybackDuration(pass)).toBe(2_000);
    expect(sumEntry(pass.startEventIndex, pass.endEventIndex)).toBe(2_000);
    expect(getPveTimelineEntryPlaybackDuration(boss)).toBe(4_250);
    expect(sumEntry(boss.startEventIndex, boss.endEventIndex)).toBe(4_250);

    const failedState = createInitialPveBattleState();
    failedState.characters.WARRIOR.alive = false;
    failedState.characters.WARRIOR.hp = 0;
    const failedPlans = createPassPvePlans();
    failedPlans.WARRIOR[0] = { actionId: "WARRIOR_DEFEND" };
    const failedResolution = resolvePveTurn(failedState, failedPlans);
    const failed = failedResolution.timeline.find((entry) =>
      entry.actorId === "WARRIOR" && entry.beat === 1
    )!;
    expect(getPveTimelineEntryPlaybackDuration(failed)).toBe(3_000);

    expect(PVE_PLAYBACK_TIMINGS.resultHoldMs).toBe(650);
    expect(getPveTurnPlaybackTimeoutMs(resolution)).toBeGreaterThan(
      getPveTurnPlaybackDuration(resolution),
    );
  });

  it("derives active, next, and completed timeline states from eventIndex", () => {
    const resolution = resolvePveTurn(
      createInitialPveBattleState(),
      createPassPvePlans(),
    );
    const first = resolution.timeline[0]!;
    const before = buildPlaybackTimelineItems(resolution.timeline, first.startEventIndex - 1);
    expect(before[0]).toEqual(expect.objectContaining({
      visualStatus: "PENDING",
      isNext: true,
    }));

    const during = buildPlaybackTimelineItems(resolution.timeline, first.startEventIndex);
    expect(during[0]).toEqual(expect.objectContaining({
      visualStatus: "ACTIVE",
      isNext: false,
    }));
    expect(during[1]).toEqual(expect.objectContaining({
      visualStatus: "PENDING",
      isNext: true,
    }));

    const duringResultHold = buildPlaybackTimelineItems(
      resolution.timeline,
      first.endEventIndex,
    );
    expect(duringResultHold[0]?.visualStatus).toBe("ACTIVE");

    const after = buildPlaybackTimelineItems(resolution.timeline, first.endEventIndex + 1);
    expect(after[0]?.visualStatus).toBe("COMPLETED");
  });

  it("shows failed engine actions as skipped after their playback range", () => {
    const state = createInitialPveBattleState();
    state.characters.WARRIOR.hp = 5;
    const plans = createPassPvePlans();
    plans.WARRIOR[1] = { actionId: "WARRIOR_SLASH" };
    const resolution = resolvePveTurn(state, plans);
    const skipped = resolution.timeline.find((entry) =>
      entry.beat === 2 && entry.actorId === "WARRIOR"
    )!;
    const items = buildPlaybackTimelineItems(
      resolution.timeline,
      skipped.endEventIndex + 1,
    );
    expect(items.find((entry) => entry.id === skipped.id)).toEqual(expect.objectContaining({
      visualStatus: "SKIPPED",
      skipReason: expect.stringContaining("쓰러져"),
    }));
  });
});
