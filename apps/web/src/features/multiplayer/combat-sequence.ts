import {
  formatHp,
  getCardDefinition,
  type PublicBattleEvent,
} from "@blind-turn/shared";

export type CombatSequenceType = "ROUND" | "STEP" | "GAME_OVER";

export type CombatOutcome =
  | "STARTED"
  | "ATTACK"
  | "GUARD"
  | "EVADE_SUCCESS"
  | "EVADE_FAILURE"
  | "COUNTER"
  | "CLASH"
  | "UTILITY"
  | "CANCELLED"
  | "MIXED"
  | "FINISHED";

export type CombatDamage = {
  playerId: string;
  damage: number;
  previousHp: number;
  remainingHp: number;
  source: "ATTACK" | "COUNTER" | "SELF" | "EVADE_FAILURE";
};

export type CombatHeal = {
  playerId: string;
  amount: number;
  previousHp: number;
  remainingHp: number;
};

export type CombatRoll = {
  playerId: string;
  kind: "CLASH" | "EVADE";
  roll: number;
  bonus: number;
  total: number;
  difficulty?: number;
  succeeded?: boolean;
};

export type CombatCardReveal = {
  playerId: string;
  cardInstanceId: string;
  cardId: string;
  cardName: string;
  targetPlayerId?: string;
};

export type CombatSequence = {
  id: string;
  type: CombatSequenceType;
  roundNumber: number;
  stepIndex: number | null;
  actorId: string | null;
  actorIds: string[];
  targetIds: string[];
  outcome: CombatOutcome;
  cards: CombatCardReveal[];
  rolls: CombatRoll[];
  damages: CombatDamage[];
  heals: CombatHeal[];
  deathPlayerIds: string[];
  winnerId: string | null;
  loserId: string | null;
  counterActorId: string | null;
  originalEventRange: { start: number; end: number };
  events: PublicBattleEvent[];
};

export type CombatDisplayPlayer = { hp: number; alive: boolean; maxHp?: number };
export type CombatDisplayState = Record<string, CombatDisplayPlayer>;

type PlayerLike = {
  playerId: string;
  hp: number;
  alive: boolean;
  maxHp?: number;
};

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function buildStepSequence(
  events: PublicBattleEvent[],
  start: number,
  end: number,
): CombatSequence {
  const stepStarted = events.find((event) => event.type === "STEP_STARTED");
  if (!stepStarted || stepStarted.type !== "STEP_STARTED") {
    throw new Error("STEP_STARTED event is required");
  }
  const cards = events
    .filter((event): event is Extract<PublicBattleEvent, { type: "CARD_REVEALED" }> =>
      event.type === "CARD_REVEALED")
    .map((event) => ({
      playerId: event.playerId,
      cardInstanceId: event.cardInstanceId,
      cardId: event.cardId,
      cardName: getCardDefinition(event.cardId).name,
      ...(event.targetPlayerId ? { targetPlayerId: event.targetPlayerId } : {}),
    }));
  const attacks = events.filter(
    (event): event is Extract<PublicBattleEvent, { type: "ATTACK_STARTED" }> =>
      event.type === "ATTACK_STARTED",
  );
  const counter = events.find(
    (event): event is Extract<PublicBattleEvent, { type: "COUNTER_TRIGGERED" }> =>
      event.type === "COUNTER_TRIGGERED",
  );
  const clash = events.find(
    (event): event is Extract<PublicBattleEvent, { type: "CLASH_RESOLVED" }> =>
      event.type === "CLASH_RESOLVED",
  );
  const guards = events.filter((event) => event.type === "GUARD_ACTIVATED");
  const evadeRolls = events.filter(
    (event): event is Extract<PublicBattleEvent, { type: "EVADE_ROLLED" }> =>
      event.type === "EVADE_ROLLED",
  );
  const cancelled = events.filter((event) => event.type === "CARD_CANCELLED");
  const damageEvents = events.filter(
    (event): event is Extract<PublicBattleEvent, { type: "DAMAGE_APPLIED" }> =>
      event.type === "DAMAGE_APPLIED",
  );
  const healEvents = events.filter(
    (event): event is Extract<PublicBattleEvent, { type: "HEAL_APPLIED" }> =>
      event.type === "HEAL_APPLIED",
  );
  const actorIds = unique(cards.map((card) => card.playerId));
  const targetIds = unique([
    ...cards.map((card) => card.targetPlayerId),
    ...attacks.map((attack) => attack.targetId),
    counter?.attackerId,
    clash?.loserId,
  ]);
  const actionKinds = new Set<string>();
  if (attacks.length > 0) actionKinds.add("ATTACK");
  if (guards.length > 0) actionKinds.add("GUARD");
  if (evadeRolls.length > 0) actionKinds.add("EVADE");
  if (counter) actionKinds.add("COUNTER");
  if (clash) actionKinds.add("CLASH");
  if (healEvents.length > 0 || cards.some((card) =>
    getCardDefinition(card.cardId).category === "UTILITY")) actionKinds.add("UTILITY");
  if (cancelled.length > 0 && actionKinds.size === 0) actionKinds.add("CANCELLED");

  let outcome: CombatOutcome = "MIXED";
  if (counter) outcome = "COUNTER";
  else if (clash) outcome = "CLASH";
  else if (evadeRolls.some((roll) => !roll.succeeded)) outcome = "EVADE_FAILURE";
  else if (evadeRolls.length > 0 && damageEvents.length === 0) outcome = "EVADE_SUCCESS";
  else if (actionKinds.size === 1) {
    outcome = [...actionKinds][0] as CombatOutcome;
  }

  const rolls: CombatRoll[] = events.flatMap((event): CombatRoll[] => {
    if (event.type === "CLASH_ROLLED") {
      return [{
        playerId: event.playerId,
        kind: "CLASH",
        roll: event.roll,
        bonus: event.bonus,
        total: event.total,
      }];
    }
    if (event.type === "EVADE_ROLLED") {
      return [{
        playerId: event.playerId,
        kind: "EVADE",
        roll: event.roll,
        bonus: event.bonus,
        total: event.roll + event.bonus,
        difficulty: event.difficulty,
        succeeded: event.succeeded,
      }];
    }
    return [];
  });

  return {
    id: `round-${stepStarted.roundNumber}-step-${stepStarted.stepIndex}`,
    type: "STEP",
    roundNumber: stepStarted.roundNumber,
    stepIndex: stepStarted.stepIndex,
    actorId: counter?.counterPlayerId
      ?? clash?.winnerId
      ?? attacks[0]?.attackerId
      ?? cards[0]?.playerId
      ?? null,
    actorIds,
    targetIds,
    outcome,
    cards,
    rolls,
    damages: damageEvents.map((event) => ({
      playerId: event.playerId,
      damage: event.damage,
      previousHp: event.remainingHp + event.damage,
      remainingHp: event.remainingHp,
      source: event.source,
    })),
    heals: healEvents.map((event) => ({
      playerId: event.playerId,
      amount: event.amount,
      previousHp: Math.max(0, event.remainingHp - event.amount),
      remainingHp: event.remainingHp,
    })),
    deathPlayerIds: events.flatMap((event) =>
      event.type === "PLAYER_DIED" ? [event.playerId] : []),
    winnerId: clash?.winnerId ?? null,
    loserId: clash?.loserId ?? null,
    counterActorId: counter?.counterPlayerId ?? null,
    originalEventRange: { start, end },
    events: [...events],
  };
}

export function buildCombatSequences(events: PublicBattleEvent[]): CombatSequence[] {
  const sequences: CombatSequence[] = [];
  let index = 0;
  let currentRound = 0;
  while (index < events.length) {
    const event = events[index]!;
    if (event.type === "ROUND_STARTED") {
      currentRound = event.roundNumber;
      sequences.push({
        id: `round-${event.roundNumber}-start`,
        type: "ROUND",
        roundNumber: event.roundNumber,
        stepIndex: null,
        actorId: null,
        actorIds: [],
        targetIds: [],
        outcome: "STARTED",
        cards: [],
        rolls: [],
        damages: [],
        heals: [],
        deathPlayerIds: [],
        winnerId: null,
        loserId: null,
        counterActorId: null,
        originalEventRange: { start: index, end: index },
        events: [event],
      });
      index += 1;
      continue;
    }
    if (event.type === "STEP_STARTED") {
      currentRound = event.roundNumber;
      let end = index;
      while (end < events.length && events[end]?.type !== "STEP_FINISHED") end += 1;
      if (end >= events.length) end = events.length - 1;
      sequences.push(buildStepSequence(events.slice(index, end + 1), index, end));
      index = end + 1;
      continue;
    }
    if (event.type === "GAME_FINISHED") {
      sequences.push({
        id: `round-${currentRound}-game-over`,
        type: "GAME_OVER",
        roundNumber: currentRound,
        stepIndex: null,
        actorId: event.result.type === "WINNER" ? event.result.winnerPlayerId : null,
        actorIds: [],
        targetIds: [],
        outcome: "FINISHED",
        cards: [],
        rolls: [],
        damages: [],
        heals: [],
        deathPlayerIds: [],
        winnerId: event.result.type === "WINNER" ? event.result.winnerPlayerId : null,
        loserId: null,
        counterActorId: null,
        originalEventRange: { start: index, end: index },
        events: [event],
      });
    }
    index += 1;
  }
  return sequences;
}

export function createCombatDisplayState(players: PlayerLike[]): CombatDisplayState {
  return Object.fromEntries(players.map((player) => [player.playerId, {
    hp: player.hp,
    alive: player.alive,
    ...(player.maxHp === undefined ? {} : { maxHp: player.maxHp }),
  }]));
}

export function hydrateCombatDamageTransitions(
  sequences: CombatSequence[],
  initialState: CombatDisplayState,
): CombatSequence[] {
  const state = synchronizeCombatDisplayState(initialState);
  return sequences.map((sequence) => {
    const damagesByEvent = new Map<number, CombatDamage>();
    const healsByEvent = new Map<number, CombatHeal>();
    let damageIndex = 0;
    let healIndex = 0;
    sequence.events.forEach((event, eventIndex) => {
      if (event.type === "HEAL_APPLIED") {
        const current = state[event.playerId]?.hp ?? Math.max(0, event.remainingHp - event.amount);
        const hydrated = { ...sequence.heals[healIndex]!, previousHp: current };
        healsByEvent.set(eventIndex, hydrated);
        state[event.playerId] = {
          ...state[event.playerId],
          hp: event.remainingHp,
          alive: event.remainingHp > 0,
        };
        healIndex += 1;
      }
      if (event.type === "DAMAGE_APPLIED") {
        const current = state[event.playerId]?.hp ?? event.remainingHp + event.damage;
        const hydrated = { ...sequence.damages[damageIndex]!, previousHp: current };
        damagesByEvent.set(eventIndex, hydrated);
        state[event.playerId] = {
          ...state[event.playerId],
          hp: event.remainingHp,
          alive: event.remainingHp > 0,
        };
        damageIndex += 1;
      }
    });
    return {
      ...sequence,
      damages: [...damagesByEvent.values()],
      heals: [...healsByEvent.values()],
    };
  });
}

export function applyCombatDamage(
  state: CombatDisplayState,
  sequence: CombatSequence,
): CombatDisplayState {
  const next = synchronizeCombatDisplayState(state);
  for (const event of sequence.events) {
    if (event.type !== "DAMAGE_APPLIED" && event.type !== "HEAL_APPLIED") continue;
    next[event.playerId] = {
      ...next[event.playerId],
      hp: event.remainingHp,
      alive: event.remainingHp > 0,
    };
  }
  return next;
}

export function applyCombatDeaths(
  state: CombatDisplayState,
  sequence: CombatSequence,
): CombatDisplayState {
  const next = synchronizeCombatDisplayState(state);
  for (const playerId of sequence.deathPlayerIds) {
    next[playerId] = { ...next[playerId], hp: 0, alive: false };
  }
  return next;
}

export function synchronizeCombatDisplayState(
  state: CombatDisplayState,
): CombatDisplayState {
  return Object.fromEntries(
    Object.entries(state).map(([playerId, player]) => [playerId, { ...player }]),
  );
}

export function describeCombatSequence(
  sequence: CombatSequence,
  names: Record<string, string>,
): string {
  const name = (playerId: string | null | undefined) =>
    playerId ? names[playerId] ?? "플레이어" : "플레이어";
  if (sequence.type === "ROUND") return `${sequence.roundNumber}라운드가 시작되었습니다.`;
  if (sequence.type === "GAME_OVER") {
    return sequence.winnerId ? `${name(sequence.winnerId)}님이 승리했습니다.` : "무승부로 끝났습니다.";
  }
  if (sequence.outcome === "COUNTER") {
    const damage = sequence.damages.map((entry) =>
      `${name(entry.playerId)} ${formatHp(entry.damage)} 피해`).join(", ");
    return `${name(sequence.counterActorId)}의 반격이 발동했습니다. ${damage}`;
  }
  if (sequence.outcome === "CLASH") {
    return `${name(sequence.winnerId)}님이 합에서 승리해 ${name(sequence.loserId)}님을 공격했습니다.`;
  }
  if (sequence.outcome === "EVADE_SUCCESS") {
    const evader = sequence.rolls.find((roll) => roll.kind === "EVADE")?.playerId;
    return `${name(evader)}님이 공격을 회피했습니다.`;
  }
  if (sequence.outcome === "EVADE_FAILURE") {
    const damage = sequence.damages[0];
    return `${name(damage?.playerId)}님의 회피가 실패해 ${formatHp(damage?.damage ?? 0)} 피해를 받았습니다.`;
  }
  if (sequence.damages.length > 0) {
    return sequence.damages.map((damage) =>
      `${name(sequence.actorId)}님이 ${name(damage.playerId)}님에게 ${formatHp(damage.damage)} 피해를 주었습니다.`
    ).join(" ");
  }
  if (sequence.heals.length > 0) {
    return sequence.heals.map((heal) =>
      `${name(heal.playerId)}님이 체력을 ${formatHp(heal.amount)} 회복했습니다.`
    ).join(" ");
  }
  const cardNames = sequence.cards.map((card) => card.cardName).join(", ");
  return `${sequence.stepIndex! + 1}단계: ${cardNames || "행동 없음"}`;
}
