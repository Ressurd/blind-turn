"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyCombatDamage,
  applyCombatDeaths,
  applyDeckPlaybackStage,
  hydrateCombatDamageTransitions,
  synchronizeCombatDisplayState,
  synchronizeCombatDeckDisplayState,
  type CombatDeckDisplayState,
  type CombatDisplayState,
  type CombatSequence,
} from "./combat-sequence";

export type CombatPlaybackStage =
  | "idle"
  | "step-intro"
  | "reveal"
  | "focus"
  | "reshuffle-start"
  | "reshuffle-shuffle"
  | "reshuffle-complete"
  | "draw"
  | "roll"
  | "clash-intro"
  | "clash-first-roll"
  | "clash-first-result"
  | "clash-second-roll"
  | "clash-second-result"
  | "clash-modifiers"
  | "clash-compare"
  | "clash-tie"
  | "clash-winner"
  | "impact"
  | "damage"
  | "death"
  | "result"
  | "summary"
  | "transition";

export type PlaybackPhase =
  | "STEP_INTRO"
  | "REVEALING_CARDS"
  | "FOCUSING_INTERACTION"
  | "PLAYING_INTERACTION"
  | "SHOWING_RESULT"
  | "APPLYING_STEP_DAMAGE"
  | "SHOWING_STEP_SUMMARY"
  | "STEP_TRANSITION"
  | "IDLE";

export type CombatPlaybackSpeed = 1 | 1.5 | 2;

export type CombatStatusState = {
  defending: string[];
  evading: string[];
  countering: string[];
};

export type CombatPlaybackBatch = {
  id: string;
  roundNumber: number;
  sequences: CombatSequence[];
  initialState: CombatDisplayState;
  serverState: CombatDisplayState;
  initialDeckState: CombatDeckDisplayState;
  serverDeckState: CombatDeckDisplayState;
};

export type CompletedCombatSequence = {
  roundNumber: number;
  sequence: CombatSequence;
};

export type PlaybackStep = {
  stage: Exclude<CombatPlaybackStage, "idle">;
  durationMs: number;
  clashAttemptIndex?: number;
};

export const PLAYBACK_BEAT_MS = 600;

export const COMBAT_PLAYBACK_BEATS = {
  stepIntro: 1,
  cardReveal: 1,
  focus: 1,
  interaction: 2,
  clashIntro: 1,
  clashRoll: 2,
  clashResult: 1,
  clashModifiers: 1,
  clashCompare: 1,
  clashTie: 1,
  clashWinner: 1,
  damage: 1,
  death: 1,
  result: 1,
  stepSummary: 2,
  transition: 1,
  reshuffleStart: 1,
  reshuffleShuffle: 2,
  reshuffleComplete: 1,
  draw: 1,
} as const;

export function getPlaybackDuration(
  beats: number,
  speed: CombatPlaybackSpeed,
): number {
  return (PLAYBACK_BEAT_MS * beats) / speed;
}

export function scalePlaybackDuration(
  durationMs: number,
  speed: CombatPlaybackSpeed,
): number {
  return durationMs / speed;
}

function beatStep(
  stage: Exclude<CombatPlaybackStage, "idle">,
  beats: number,
): PlaybackStep {
  return { stage, durationMs: PLAYBACK_BEAT_MS * beats };
}

export function playbackPhaseForStage(stage: CombatPlaybackStage): PlaybackPhase {
  if (stage === "step-intro") return "STEP_INTRO";
  if (stage === "reveal") return "REVEALING_CARDS";
  if (stage === "focus") return "FOCUSING_INTERACTION";
  if (["roll", "impact", "clash-intro", "clash-first-roll", "clash-first-result", "clash-second-roll", "clash-second-result", "clash-modifiers", "reshuffle-start", "reshuffle-shuffle", "reshuffle-complete", "draw"].includes(stage)) return "PLAYING_INTERACTION";
  if (["clash-compare", "clash-tie", "clash-winner"].includes(stage)) return "SHOWING_RESULT";
  if (stage === "damage") return "APPLYING_STEP_DAMAGE";
  if (stage === "death" || stage === "result") return "SHOWING_RESULT";
  if (stage === "summary") return "SHOWING_STEP_SUMMARY";
  if (stage === "transition") return "STEP_TRANSITION";
  return "IDLE";
}

type TimerHandle = ReturnType<typeof setTimeout>;

export function createPlaybackTimer(
  scheduleTimeout: typeof setTimeout = setTimeout,
  cancelTimeout: typeof clearTimeout = clearTimeout,
) {
  let handle: TimerHandle | null = null;
  return {
    schedule(callback: () => void, delayMs: number) {
      if (handle) cancelTimeout(handle);
      handle = scheduleTimeout(() => {
        handle = null;
        callback();
      }, delayMs);
    },
    dispose() {
      if (handle) cancelTimeout(handle);
      handle = null;
    },
    hasPending() {
      return handle !== null;
    },
  };
}

export function getCombatPlaybackSteps(
  sequence: CombatSequence,
  reducedMotion = false,
): PlaybackStep[] {
  if (sequence.type === "ROUND") {
    return [beatStep("step-intro", COMBAT_PLAYBACK_BEATS.stepIntro)];
  }
  if (sequence.type === "ROUND_SUMMARY") {
    return [beatStep("summary", COMBAT_PLAYBACK_BEATS.stepSummary)];
  }
  if (sequence.type === "GAME_OVER") {
    return [
      beatStep("step-intro", COMBAT_PLAYBACK_BEATS.stepIntro),
      beatStep("result", COMBAT_PLAYBACK_BEATS.stepSummary),
    ];
  }
  if (sequence.type === "DECK") {
    const deckSteps: PlaybackStep[] = [
      beatStep("step-intro", COMBAT_PLAYBACK_BEATS.stepIntro),
    ];
    if (sequence.reshuffles.length > 0) {
      deckSteps.push(
        beatStep("reshuffle-start", COMBAT_PLAYBACK_BEATS.reshuffleStart),
        beatStep("reshuffle-shuffle", COMBAT_PLAYBACK_BEATS.reshuffleShuffle),
        beatStep("reshuffle-complete", COMBAT_PLAYBACK_BEATS.reshuffleComplete),
      );
    }
    if (sequence.draws.length > 0) {
      deckSteps.push(beatStep("draw", COMBAT_PLAYBACK_BEATS.draw));
    }
    deckSteps.push(beatStep("result", COMBAT_PLAYBACK_BEATS.result));
    return deckSteps;
  }
  const steps: PlaybackStep[] = [
    beatStep("step-intro", COMBAT_PLAYBACK_BEATS.stepIntro),
    beatStep("reveal", COMBAT_PLAYBACK_BEATS.cardReveal),
  ];
  if (sequence.outcome === "CLASH" && sequence.clash?.attempts.length) {
    steps.push(beatStep("clash-intro", COMBAT_PLAYBACK_BEATS.clashIntro));
    for (const [clashAttemptIndex, attempt] of sequence.clash.attempts.entries()) {
      if (!reducedMotion) {
        steps.push({
          ...beatStep("clash-first-roll", COMBAT_PLAYBACK_BEATS.clashRoll),
          clashAttemptIndex,
        });
      }
      steps.push({
        ...beatStep("clash-first-result", COMBAT_PLAYBACK_BEATS.clashResult),
        clashAttemptIndex,
      });
      if (!reducedMotion) {
        steps.push({
          ...beatStep("clash-second-roll", COMBAT_PLAYBACK_BEATS.clashRoll),
          clashAttemptIndex,
        });
      }
      steps.push(
        { ...beatStep("clash-second-result", COMBAT_PLAYBACK_BEATS.clashResult), clashAttemptIndex },
        { ...beatStep("clash-modifiers", COMBAT_PLAYBACK_BEATS.clashModifiers), clashAttemptIndex },
        { ...beatStep("clash-compare", COMBAT_PLAYBACK_BEATS.clashCompare), clashAttemptIndex },
      );
      if (attempt.tied) {
        steps.push({
          ...beatStep("clash-tie", COMBAT_PLAYBACK_BEATS.clashTie),
          clashAttemptIndex,
        });
      }
    }
    const finalAttemptIndex = sequence.clash.attempts.length - 1;
    steps.push({
      ...beatStep("clash-winner", COMBAT_PLAYBACK_BEATS.clashWinner),
      clashAttemptIndex: finalAttemptIndex,
    });
    if (sequence.damages.length > 0) {
      steps.push(beatStep("impact", COMBAT_PLAYBACK_BEATS.interaction));
    }
    if (sequence.damages.length > 0 || sequence.heals.length > 0) {
      steps.push(beatStep("damage", COMBAT_PLAYBACK_BEATS.damage));
    }
    if (sequence.deathPlayerIds.length > 0) {
      steps.push(beatStep("death", COMBAT_PLAYBACK_BEATS.death));
    }
    steps.push(
      beatStep("summary", COMBAT_PLAYBACK_BEATS.result),
      beatStep("transition", COMBAT_PLAYBACK_BEATS.transition),
    );
    return steps;
  }
  steps.push(beatStep("focus", COMBAT_PLAYBACK_BEATS.focus));
  if (sequence.reshuffles.length > 0) {
    steps.push(
      beatStep("reshuffle-start", COMBAT_PLAYBACK_BEATS.reshuffleStart),
      beatStep("reshuffle-shuffle", COMBAT_PLAYBACK_BEATS.reshuffleShuffle),
      beatStep("reshuffle-complete", COMBAT_PLAYBACK_BEATS.reshuffleComplete),
    );
  }
  if (sequence.draws.length > 0) {
    steps.push(beatStep("draw", COMBAT_PLAYBACK_BEATS.draw));
  }
  if (sequence.rolls.length > 0 || sequence.outcome === "COUNTER") {
    steps.push(beatStep(
      "roll",
      COMBAT_PLAYBACK_BEATS.interaction,
    ));
  } else {
    steps.push(beatStep("impact", COMBAT_PLAYBACK_BEATS.interaction));
  }
  if (sequence.damages.length > 0 || sequence.heals.length > 0) {
    steps.push(beatStep("damage", COMBAT_PLAYBACK_BEATS.damage));
  }
  if (sequence.deathPlayerIds.length > 0) {
    steps.push(beatStep("death", COMBAT_PLAYBACK_BEATS.death));
  }
  steps.push(
    beatStep("summary", COMBAT_PLAYBACK_BEATS.stepSummary),
    beatStep("transition", COMBAT_PLAYBACK_BEATS.transition),
  );
  return steps;
}

function statusesFor(sequence: CombatSequence): CombatStatusState {
  const defending: string[] = [];
  const evading: string[] = [];
  const countering: string[] = [];
  for (const card of sequence.cards) {
    const kind = card.cardId.includes("GUARD") || card.cardId.includes("FORTRESS")
      ? "GUARD"
      : card.cardId.includes("EVADE")
        ? "EVADE"
        : card.cardId.includes("COUNTER") || card.cardId.includes("RIPOSTE")
          ? "COUNTER"
          : null;
    if (kind === "GUARD") defending.push(card.playerId);
    if (kind === "EVADE") evading.push(card.playerId);
    if (kind === "COUNTER") countering.push(card.playerId);
  }
  return { defending, evading, countering };
}

export function useCombatPlayback(options: {
  onRoundComplete: (roundNumber: number) => void;
}) {
  const [currentSequence, setCurrentSequence] = useState<CombatSequence | null>(null);
  const [currentStage, setCurrentStage] = useState<CombatPlaybackStage>("idle");
  const [currentRoundNumber, setCurrentRoundNumber] = useState<number | null>(null);
  const [displayState, setDisplayStateState] = useState<CombatDisplayState>({});
  const [displayDeckState, setDisplayDeckStateState] = useState<CombatDeckDisplayState>({});
  const [completedSequences, setCompletedSequences] = useState<CompletedCombatSequence[]>([]);
  const [statuses, setStatuses] = useState<CombatStatusState>({
    defending: [],
    evading: [],
    countering: [],
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [speed, setSpeedState] = useState<CombatPlaybackSpeed>(1);
  const [currentDurationMs, setCurrentDurationMs] = useState(0);
  const [currentClashAttemptIndex, setCurrentClashAttemptIndex] = useState(0);

  const timerRef = useRef(createPlaybackTimer());
  const queueRef = useRef<CombatPlaybackBatch[]>([]);
  const currentBatchRef = useRef<CombatPlaybackBatch | null>(null);
  const sequenceIndexRef = useRef(0);
  const stepIndexRef = useRef(0);
  const stepsRef = useRef<PlaybackStep[]>([]);
  const currentSequenceRef = useRef<CombatSequence | null>(null);
  const displayStateRef = useRef<CombatDisplayState>({});
  const displayDeckStateRef = useRef<CombatDeckDisplayState>({});
  const isPlayingRef = useRef(false);
  const pausedRef = useRef(false);
  const speedRef = useRef<CombatPlaybackSpeed>(1);
  const reducedMotionRef = useRef(false);
  const seenBatchIdsRef = useRef(new Set<string>());
  const onRoundCompleteRef = useRef(options.onRoundComplete);
  const startNextBatchRef = useRef<() => void>(() => undefined);
  const startSequenceRef = useRef<() => void>(() => undefined);
  const enterStepRef = useRef<() => void>(() => undefined);
  const advanceStepRef = useRef<() => void>(() => undefined);

  onRoundCompleteRef.current = options.onRoundComplete;

  function setDisplayState(state: CombatDisplayState): void {
    displayStateRef.current = state;
    setDisplayStateState(state);
  }

  function setDisplayDeckState(state: CombatDeckDisplayState): void {
    displayDeckStateRef.current = state;
    setDisplayDeckStateState(state);
  }

  function scheduleCurrentStep(): void {
    const step = stepsRef.current[stepIndexRef.current];
    if (!step || pausedRef.current) return;
    timerRef.current.schedule(
      () => advanceStepRef.current(),
      scalePlaybackDuration(step.durationMs, speedRef.current),
    );
  }

  enterStepRef.current = () => {
    const sequence = currentSequenceRef.current;
    const step = stepsRef.current[stepIndexRef.current];
    if (!sequence || !step) return;
    setCurrentStage(step.stage);
    setCurrentClashAttemptIndex(
      step.clashAttemptIndex
      ?? (sequence.outcome === "CLASH"
        ? Math.max(0, (sequence.clash?.attempts.length ?? 1) - 1)
        : 0),
    );
    setCurrentDurationMs(getPlaybackDuration(
      step.durationMs / PLAYBACK_BEAT_MS,
      speedRef.current,
    ));
    if (step.stage === "damage") {
      setDisplayState(applyCombatDamage(displayStateRef.current, sequence));
    }
    if (step.stage === "death") {
      setDisplayState(applyCombatDeaths(displayStateRef.current, sequence));
    }
    if (step.stage === "reshuffle-start" || step.stage === "reshuffle-complete" || step.stage === "draw") {
      setDisplayDeckState(
        applyDeckPlaybackStage(displayDeckStateRef.current, sequence, step.stage),
      );
    }
    scheduleCurrentStep();
  };

  advanceStepRef.current = () => {
    const batch = currentBatchRef.current;
    const sequence = currentSequenceRef.current;
    if (!batch || !sequence) return;
    if (stepIndexRef.current + 1 < stepsRef.current.length) {
      stepIndexRef.current += 1;
      enterStepRef.current();
      return;
    }
    setCompletedSequences((current) => [
      ...current,
      { roundNumber: batch.roundNumber, sequence },
    ]);
    sequenceIndexRef.current += 1;
    if (sequenceIndexRef.current < batch.sequences.length) {
      startSequenceRef.current();
      return;
    }
    setDisplayState(synchronizeCombatDisplayState(batch.serverState));
    setDisplayDeckState(synchronizeCombatDeckDisplayState(batch.serverDeckState));
    onRoundCompleteRef.current(batch.roundNumber);
    currentBatchRef.current = null;
    startNextBatchRef.current();
  };

  startSequenceRef.current = () => {
    const batch = currentBatchRef.current;
    const sequence = batch?.sequences[sequenceIndexRef.current];
    if (!batch || !sequence) {
      if (batch) {
        setDisplayState(synchronizeCombatDisplayState(batch.serverState));
        setDisplayDeckState(synchronizeCombatDeckDisplayState(batch.serverDeckState));
        onRoundCompleteRef.current(batch.roundNumber);
      }
      currentBatchRef.current = null;
      startNextBatchRef.current();
      return;
    }
    currentSequenceRef.current = sequence;
    stepsRef.current = getCombatPlaybackSteps(sequence, reducedMotionRef.current);
    stepIndexRef.current = 0;
    setCurrentSequence(sequence);
    setStatuses(statusesFor(sequence));
    enterStepRef.current();
  };

  startNextBatchRef.current = () => {
    const batch = queueRef.current.shift() ?? null;
    if (!batch) {
      timerRef.current.dispose();
      currentBatchRef.current = null;
      currentSequenceRef.current = null;
      isPlayingRef.current = false;
      pausedRef.current = false;
      setCurrentSequence(null);
      setCurrentStage("idle");
      setCurrentDurationMs(0);
      setCurrentClashAttemptIndex(0);
      setCurrentRoundNumber(null);
      setStatuses({ defending: [], evading: [], countering: [] });
      setIsPlaying(false);
      setIsPaused(false);
      return;
    }
    currentBatchRef.current = {
      ...batch,
      sequences: hydrateCombatDamageTransitions(batch.sequences, batch.initialState),
    };
    sequenceIndexRef.current = 0;
    setCurrentRoundNumber(batch.roundNumber);
    setDisplayState(synchronizeCombatDisplayState(batch.initialState));
    setDisplayDeckState(synchronizeCombatDeckDisplayState(batch.initialDeckState));
    startSequenceRef.current();
  };

  const enqueueBatch = useCallback((batch: CombatPlaybackBatch): boolean => {
    if (seenBatchIdsRef.current.has(batch.id)) return false;
    seenBatchIdsRef.current.add(batch.id);
    queueRef.current.push(batch);
    if (!isPlayingRef.current) {
      isPlayingRef.current = true;
      setIsPlaying(true);
      startNextBatchRef.current();
    }
    return true;
  }, []);

  const syncServerState = useCallback((
    state: CombatDisplayState,
    deckState?: CombatDeckDisplayState,
  ): void => {
    if (!isPlayingRef.current && queueRef.current.length === 0) {
      setDisplayState(synchronizeCombatDisplayState(state));
      if (deckState) {
        setDisplayDeckState(synchronizeCombatDeckDisplayState(deckState));
      }
    }
  }, []);

  const togglePause = useCallback(() => {
    if (!isPlayingRef.current) return;
    pausedRef.current = !pausedRef.current;
    setIsPaused(pausedRef.current);
    if (pausedRef.current) timerRef.current.dispose();
    else scheduleCurrentStep();
  }, []);

  const setSpeed = useCallback((nextSpeed: CombatPlaybackSpeed) => {
    speedRef.current = nextSpeed;
    setSpeedState(nextSpeed);
    const step = stepsRef.current[stepIndexRef.current];
    if (step) {
      setCurrentDurationMs(getPlaybackDuration(
        step.durationMs / PLAYBACK_BEAT_MS,
        nextSpeed,
      ));
    }
    if (isPlayingRef.current && !pausedRef.current) {
      timerRef.current.dispose();
      scheduleCurrentStep();
    }
  }, []);

  const skip = useCallback(() => {
    const batches = [
      ...(currentBatchRef.current ? [currentBatchRef.current] : []),
      ...queueRef.current,
    ];
    if (batches.length === 0) return;
    timerRef.current.dispose();
    const records: CompletedCombatSequence[] = [];
    for (const batch of batches) {
      const from = batch === currentBatchRef.current ? sequenceIndexRef.current : 0;
      for (const sequence of batch.sequences.slice(from)) {
        records.push({ roundNumber: batch.roundNumber, sequence });
      }
      onRoundCompleteRef.current(batch.roundNumber);
    }
    setCompletedSequences((current) => [...current, ...records]);
    setDisplayState(synchronizeCombatDisplayState(batches.at(-1)!.serverState));
    setDisplayDeckState(synchronizeCombatDeckDisplayState(batches.at(-1)!.serverDeckState));
    queueRef.current = [];
    currentBatchRef.current = null;
    currentSequenceRef.current = null;
    isPlayingRef.current = false;
    pausedRef.current = false;
    setCurrentSequence(null);
    setCurrentStage("idle");
    setCurrentDurationMs(0);
    setCurrentClashAttemptIndex(0);
    setCurrentRoundNumber(null);
    setStatuses({ defending: [], evading: [], countering: [] });
    setIsPlaying(false);
    setIsPaused(false);
  }, []);

  const reset = useCallback((
    state: CombatDisplayState = {},
    deckState: CombatDeckDisplayState = {},
  ) => {
    timerRef.current.dispose();
    queueRef.current = [];
    currentBatchRef.current = null;
    currentSequenceRef.current = null;
    sequenceIndexRef.current = 0;
    stepIndexRef.current = 0;
    seenBatchIdsRef.current.clear();
    isPlayingRef.current = false;
    pausedRef.current = false;
    setCurrentSequence(null);
    setCurrentStage("idle");
    setCurrentDurationMs(0);
    setCurrentClashAttemptIndex(0);
    setCurrentRoundNumber(null);
    setDisplayState(synchronizeCombatDisplayState(state));
    setDisplayDeckState(synchronizeCombatDeckDisplayState(deckState));
    setCompletedSequences([]);
    setStatuses({ defending: [], evading: [], countering: [] });
    setIsPlaying(false);
    setIsPaused(false);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      reducedMotionRef.current = media.matches;
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => () => {
    timerRef.current.dispose();
    queueRef.current = [];
    currentBatchRef.current = null;
    isPlayingRef.current = false;
  }, []);

  return {
    currentSequence,
    currentStage,
    currentClashAttemptIndex,
    phase: playbackPhaseForStage(currentStage),
    currentDurationMs,
    currentRoundNumber,
    displayState,
    displayDeckState,
    completedSequences,
    statuses,
    isPlaying,
    isPaused,
    speed,
    enqueueBatch,
    syncServerState,
    togglePause,
    setSpeed,
    skip,
    reset,
  };
}
