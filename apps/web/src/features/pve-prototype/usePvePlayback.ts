"use client";

import type {
  PveBattleState,
  PveTurnResolution,
} from "@blind-turn/shared";
import { getPvePlaybackEventDuration } from "@blind-turn/shared";
import { useCallback, useEffect, useReducer, useState } from "react";

export type PvePlaybackState = {
  resolution: PveTurnResolution | null;
  displayState: PveBattleState;
  eventIndex: number;
  isPlaying: boolean;
};

export type PvePlaybackAction =
  | { type: "START"; resolution: PveTurnResolution; initialState: PveBattleState }
  | { type: "ADVANCE" }
  | { type: "TOGGLE" }
  | { type: "SKIP" }
  | { type: "RESET"; initialState: PveBattleState };

export function reducePvePlayback(
  state: PvePlaybackState,
  action: PvePlaybackAction,
): PvePlaybackState {
  switch (action.type) {
    case "START":
      if (state.resolution) return state;
      return {
        resolution: action.resolution,
        displayState: action.initialState,
        eventIndex: -1,
        isPlaying: true,
      };
    case "ADVANCE": {
      if (!state.resolution || !state.isPlaying) return state;
      const nextIndex = state.eventIndex + 1;
      const nextEvent = state.resolution.events[nextIndex];
      if (!nextEvent) return { ...state, isPlaying: false };
      return {
        ...state,
        eventIndex: nextIndex,
        displayState: nextEvent.state,
        isPlaying: nextIndex < state.resolution.events.length - 1,
      };
    }
    case "TOGGLE":
      if (!state.resolution || state.eventIndex >= state.resolution.events.length - 1) {
        return state;
      }
      return { ...state, isPlaying: !state.isPlaying };
    case "SKIP":
      if (!state.resolution) return state;
      return {
        ...state,
        displayState: state.resolution.state,
        eventIndex: state.resolution.events.length - 1,
        isPlaying: false,
      };
    case "RESET":
      return {
        resolution: null,
        displayState: action.initialState,
        eventIndex: -1,
        isPlaying: false,
      };
  }
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function usePvePlayback(initialState: PveBattleState) {
  const [state, dispatch] = useReducer(reducePvePlayback, {
    resolution: null,
    displayState: initialState,
    eventIndex: -1,
    isPlaying: false,
  });
  const reducedMotion = useReducedMotion();
  const currentEvent = state.resolution && state.eventIndex >= 0
    ? state.resolution.events[state.eventIndex] ?? null
    : null;

  useEffect(() => {
    if (!state.isPlaying || !state.resolution) return;
    const timer = window.setTimeout(
      () => dispatch({ type: "ADVANCE" }),
      getPvePlaybackEventDuration(state.resolution, state.eventIndex, reducedMotion),
    );
    return () => window.clearTimeout(timer);
  }, [currentEvent, reducedMotion, state.isPlaying, state.resolution]);

  const start = useCallback((resolution: PveTurnResolution, startState: PveBattleState) => {
    dispatch({ type: "START", resolution, initialState: startState });
  }, []);
  const toggle = useCallback(() => dispatch({ type: "TOGGLE" }), []);
  const skip = useCallback(() => dispatch({ type: "SKIP" }), []);
  const reset = useCallback((startState: PveBattleState) => {
    dispatch({ type: "RESET", initialState: startState });
  }, []);

  return {
    ...state,
    currentEvent,
    reducedMotion,
    start,
    toggle,
    skip,
    reset,
  };
}
