"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyCombatDamage,
  applyCombatDeaths,
  hydrateCombatDamageTransitions,
  synchronizeCombatDisplayState,
  type CombatDisplayState,
  type CombatSequence,
} from "./combat-sequence";

export type CombatPlaybackStage =
  | "idle"
  | "reveal"
  | "roll"
  | "impact"
  | "damage"
  | "death"
  | "result";

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
};

export type CompletedCombatSequence = {
  roundNumber: number;
  sequence: CombatSequence;
};

type PlaybackStep = {
  stage: Exclude<CombatPlaybackStage, "idle">;
  durationMs: number;
};

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

export function getCombatPlaybackSteps(sequence: CombatSequence): PlaybackStep[] {
  if (sequence.type === "ROUND") {
    return [{ stage: "reveal", durationMs: 450 }];
  }
  if (sequence.type === "GAME_OVER") {
    return [
      { stage: "reveal", durationMs: 450 },
      { stage: "result", durationMs: 700 },
    ];
  }
  const steps: PlaybackStep[] = [{ stage: "reveal", durationMs: 500 }];
  if (sequence.rolls.length > 0 || sequence.outcome === "COUNTER") {
    steps.push({ stage: "roll", durationMs: 700 });
  }
  if (
    sequence.damages.length > 0
    || sequence.outcome === "EVADE_SUCCESS"
    || sequence.outcome === "EVADE_FAILURE"
  ) {
    steps.push({ stage: "impact", durationMs: 300 });
  }
  if (sequence.damages.length > 0 || sequence.heals.length > 0) {
    steps.push({ stage: "damage", durationMs: 500 });
  }
  if (sequence.deathPlayerIds.length > 0) {
    steps.push({ stage: "death", durationMs: 700 });
  }
  steps.push({ stage: "result", durationMs: 400 });
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
  const [completedSequences, setCompletedSequences] = useState<CompletedCombatSequence[]>([]);
  const [statuses, setStatuses] = useState<CombatStatusState>({
    defending: [],
    evading: [],
    countering: [],
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [speed, setSpeedState] = useState<CombatPlaybackSpeed>(1);

  const timerRef = useRef(createPlaybackTimer());
  const queueRef = useRef<CombatPlaybackBatch[]>([]);
  const currentBatchRef = useRef<CombatPlaybackBatch | null>(null);
  const sequenceIndexRef = useRef(0);
  const stepIndexRef = useRef(0);
  const stepsRef = useRef<PlaybackStep[]>([]);
  const currentSequenceRef = useRef<CombatSequence | null>(null);
  const displayStateRef = useRef<CombatDisplayState>({});
  const isPlayingRef = useRef(false);
  const pausedRef = useRef(false);
  const speedRef = useRef<CombatPlaybackSpeed>(1);
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

  function scheduleCurrentStep(): void {
    const step = stepsRef.current[stepIndexRef.current];
    if (!step || pausedRef.current) return;
    timerRef.current.schedule(
      () => advanceStepRef.current(),
      Math.max(90, step.durationMs / speedRef.current),
    );
  }

  enterStepRef.current = () => {
    const sequence = currentSequenceRef.current;
    const step = stepsRef.current[stepIndexRef.current];
    if (!sequence || !step) return;
    setCurrentStage(step.stage);
    if (step.stage === "damage") {
      setDisplayState(applyCombatDamage(displayStateRef.current, sequence));
    }
    if (step.stage === "death") {
      setDisplayState(applyCombatDeaths(displayStateRef.current, sequence));
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
        onRoundCompleteRef.current(batch.roundNumber);
      }
      currentBatchRef.current = null;
      startNextBatchRef.current();
      return;
    }
    currentSequenceRef.current = sequence;
    stepsRef.current = getCombatPlaybackSteps(sequence);
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

  const syncServerState = useCallback((state: CombatDisplayState): void => {
    if (!isPlayingRef.current && queueRef.current.length === 0) {
      setDisplayState(synchronizeCombatDisplayState(state));
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
    queueRef.current = [];
    currentBatchRef.current = null;
    currentSequenceRef.current = null;
    isPlayingRef.current = false;
    pausedRef.current = false;
    setCurrentSequence(null);
    setCurrentStage("idle");
    setCurrentRoundNumber(null);
    setStatuses({ defending: [], evading: [], countering: [] });
    setIsPlaying(false);
    setIsPaused(false);
  }, []);

  const reset = useCallback((state: CombatDisplayState = {}) => {
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
    setCurrentRoundNumber(null);
    setDisplayState(synchronizeCombatDisplayState(state));
    setCompletedSequences([]);
    setStatuses({ defending: [], evading: [], countering: [] });
    setIsPlaying(false);
    setIsPaused(false);
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
    currentRoundNumber,
    displayState,
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
