import { HP_SCALE, MAX_CARDS_PER_ROUND, MAX_HAND_SIZE } from "../constants";
import { getCardDefinition } from "../cards/card-catalog";
import {
  cloneCardInstance,
  drawCards,
  removeCardInstance,
} from "../deck/deck-state";
import { prepareRewardOptions } from "../rewards/reward-state";
import type { RandomSource } from "../random";
import { rollDie } from "../random";
import { cloneGameState } from "../state/game-state";
import type {
  ActionCardInstance,
  BattleEvent,
  CardDefinition,
  DamageSource,
  GameState,
  PlayerState,
  QueuedCardAction,
} from "../types";
import {
  GameEngineError,
  haveAllAlivePlayersConfirmed,
} from "./round-actions";

type ActiveAction = {
  player: PlayerState;
  queued: QueuedCardAction;
  instance: ActionCardInstance;
  card: CardDefinition;
};

type AttackAction = ActiveAction & {
  targetId: string;
  damage: number;
  clashBonus: number;
  evadeDifficulty: number;
  guardPierce: number;
};

type AttackPacket = {
  attackerId: string;
  targetId: string;
  cardId: string;
  damage: number;
  evadeDifficulty: number;
  guardPierce: number;
  source: "ATTACK" | "EVADE_FAILURE";
};

type SpecialPacket = {
  playerId: string;
  damage: number;
  source: "COUNTER" | "SELF";
};

function appendDrawEvents(
  events: BattleEvent[],
  playerId: string,
  drawn: ReturnType<typeof drawCards>,
): void {
  if (drawn.reshuffled) {
    events.push(
      {
        type: "DISCARD_RESHUFFLE_STARTED",
        playerId,
        discardCount: drawn.reshuffled.discardCount,
      },
      {
        type: "DISCARD_RESHUFFLED",
        playerId,
        drawPileCount: drawn.reshuffled.drawPileCount,
      },
    );
  }
  if (drawn.drawn.length > 0) {
    events.push({
      type: "CARD_DRAWN",
      playerId,
      count: drawn.drawn.length,
      drawPileCount: drawn.state.drawPile.length,
      handCount: drawn.state.hand.length,
    });
  }
}

function findPlayer(state: GameState, playerId: string): PlayerState {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error(`Unknown player: ${playerId}`);
  return player;
}

function attackDamage(
  action: ActiveAction,
  target: PlayerState,
  stepStartHp: Readonly<Record<string, number>>,
): number {
  const effect = action.card.effect;
  let damage = effect.damage ?? 0;
  if (action.player.characterId === "BERSERKER") damage += HP_SCALE;
  if (
    effect.special === "EXECUTE"
    && stepStartHp[target.id]! <= (effect.executeThreshold ?? 0)
  ) {
    damage += effect.executeBonusDamage ?? 0;
  }
  return damage;
}

function sourcePriority(sources: readonly DamageSource[]): DamageSource {
  if (sources.includes("EVADE_FAILURE")) return "EVADE_FAILURE";
  if (sources.includes("COUNTER")) return "COUNTER";
  if (sources.includes("SELF")) return "SELF";
  return "ATTACK";
}

function applyUtilityAction(
  state: GameState,
  action: ActiveAction,
  randomSource: RandomSource,
  events: BattleEvent[],
  heals: Map<string, number>,
): void {
  const player = findPlayer(state, action.player.id);
  const effect = action.card.effect;
  if (effect.kind === "HEAL") {
    heals.set(player.id, (heals.get(player.id) ?? 0) + (effect.heal ?? 0));
    return;
  }
  if (effect.kind === "DRAW") {
    const drawn = drawCards(player.deckState, effect.draw ?? 0, randomSource);
    player.deckState = drawn.state;
    appendDrawEvents(events, player.id, drawn);
    return;
  }
  if (effect.kind === "RECYCLE") {
    const selection = action.queued.additionalSelection;
    if (!selection || !("discardCardInstanceId" in selection)) return;
    if (player.deckState.hand.length >= MAX_HAND_SIZE) return;
    const index = player.deckState.discardPile.findIndex(
      (card) => card.instanceId === selection.discardCardInstanceId,
    );
    if (index < 0) return;
    const [card] = player.deckState.discardPile.splice(index, 1);
    if (card) player.deckState.hand.push(card);
    return;
  }
  if (effect.kind === "MULLIGAN") {
    const selection = action.queued.additionalSelection;
    if (!selection || !("handCardInstanceIds" in selection)) return;
    let moved = 0;
    for (const instanceId of selection.handCardInstanceIds) {
      const index = player.deckState.hand.findIndex(
        (card) => card.instanceId === instanceId,
      );
      if (index < 0) continue;
      const [card] = player.deckState.hand.splice(index, 1);
      if (card) {
        player.deckState.discardPile.push(card);
        moved += 1;
      }
    }
    const drawn = drawCards(player.deckState, moved, randomSource);
    player.deckState = drawn.state;
    appendDrawEvents(events, player.id, drawn);
    return;
  }
  if (effect.kind === "SIFT") {
    const drawn = drawCards(player.deckState, effect.draw ?? 2, randomSource);
    player.deckState = drawn.state;
    appendDrawEvents(events, player.id, drawn);
    const selection = action.queued.additionalSelection;
    if (!selection || !("returnCardInstanceId" in selection)) return;
    const index = player.deckState.hand.findIndex(
      (card) => card.instanceId === selection.returnCardInstanceId,
    );
    if (index < 0) return;
    const [card] = player.deckState.hand.splice(index, 1);
    if (card) player.deckState.drawPile.push(card);
  }
}

function resolveStep(
  state: GameState,
  stepIndex: number,
  randomSource: RandomSource,
  events: BattleEvent[],
  usedCards: Map<string, ActionCardInstance[]>,
  returnToHand: Set<string>,
): void {
  events.push({
    type: "STEP_STARTED",
    roundNumber: state.roundNumber,
    stepIndex,
  });
  const stepStartHp = Object.fromEntries(
    state.players.map((player) => [player.id, player.hp]),
  );
  const activeActions: ActiveAction[] = [];

  for (const player of [...state.players].sort(
    (left, right) => left.seatNumber - right.seatNumber,
  )) {
    const queued = player.deckState.queuedCards.find(
      (candidate) => candidate.order === stepIndex,
    );
    if (!queued) continue;
    if (!player.alive) {
      events.push({
        type: "CARD_CANCELLED",
        roundNumber: state.roundNumber,
        stepIndex,
        playerId: player.id,
        cardInstanceId: queued.cardInstanceId,
        reason: "PLAYER_DEAD",
      });
      continue;
    }
    const instance = player.deckState.hand.find(
      (candidate) => candidate.instanceId === queued.cardInstanceId,
    );
    if (!instance) throw new GameEngineError("CARD_NOT_IN_HAND");
    const card = getCardDefinition(instance.cardId);
    events.push({
      type: "CARD_REVEALED",
      roundNumber: state.roundNumber,
      stepIndex,
      playerId: player.id,
      cardInstanceId: instance.instanceId,
      cardId: instance.cardId,
      ...(queued.targetPlayerId ? { targetPlayerId: queued.targetPlayerId } : {}),
    });
    const removed = removeCardInstance(player.deckState, instance.instanceId);
    if (!removed.removed) throw new GameEngineError("CARD_NOT_IN_HAND");
    player.deckState = removed.state;
    const playerUsedCards = usedCards.get(player.id) ?? [];
    playerUsedCards.push(cloneCardInstance(removed.removed));
    usedCards.set(player.id, playerUsedCards);

    if (card.targetType === "ENEMY") {
      const target = state.players.find(
        (candidate) => candidate.id === queued.targetPlayerId,
      );
      if (!target?.alive) {
        events.push({
          type: "CARD_CANCELLED",
          roundNumber: state.roundNumber,
          stepIndex,
          playerId: player.id,
          cardInstanceId: instance.instanceId,
          reason: "TARGET_DEAD",
        });
        continue;
      }
    }
    activeActions.push({ player, queued, instance, card });
  }

  const attackActions: AttackAction[] = activeActions
    .filter((action) => action.card.effect.kind === "ATTACK")
    .map((action) => {
      const target = findPlayer(state, action.queued.targetPlayerId!);
      const attack: AttackAction = {
        ...action,
        targetId: target.id,
        damage: attackDamage(action, target, stepStartHp),
        clashBonus: action.card.effect.clashBonus ?? 0,
        evadeDifficulty: action.card.effect.evadeDifficulty ?? 10,
        guardPierce: action.card.effect.guardPierce ?? 0,
      };
      events.push({
        type: "ATTACK_STARTED",
        stepIndex,
        attackerId: action.player.id,
        targetId: target.id,
        cardId: action.card.id,
        damage: attack.damage,
      });
      return attack;
    });

  const resolvedAttackers = new Set<string>();
  const attackPackets: AttackPacket[] = [];
  const specialPackets: SpecialPacket[] = [];
  const clashWinnersToDraw = new Set<string>();

  for (const attack of attackActions) {
    if (resolvedAttackers.has(attack.player.id)) continue;
    const reciprocal = attackActions.find(
      (candidate) =>
        candidate.player.id === attack.targetId
        && candidate.targetId === attack.player.id
        && !resolvedAttackers.has(candidate.player.id),
    );
    if (!reciprocal) continue;
    resolvedAttackers.add(attack.player.id);
    resolvedAttackers.add(reciprocal.player.id);
    events.push({
      type: "CLASH_STARTED",
      stepIndex,
      playerIds: [attack.player.id, reciprocal.player.id],
      cardIds: [attack.card.id, reciprocal.card.id],
    });
    let winner: AttackAction | null = null;
    let loser: AttackAction | null = null;
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      const firstRoll = rollDie(randomSource, "CLASH");
      const secondRoll = rollDie(randomSource, "CLASH");
      const firstBonus = attack.clashBonus
        + (attack.player.characterId === "DUELIST" ? 1 : 0);
      const secondBonus = reciprocal.clashBonus
        + (reciprocal.player.characterId === "DUELIST" ? 1 : 0);
      const firstTotal = firstRoll + firstBonus;
      const secondTotal = secondRoll + secondBonus;
      events.push(
        {
          type: "CLASH_ROLLED",
          stepIndex,
          playerId: attack.player.id,
          roll: firstRoll,
          bonus: firstBonus,
          total: firstTotal,
        },
        {
          type: "CLASH_ROLLED",
          stepIndex,
          playerId: reciprocal.player.id,
          roll: secondRoll,
          bonus: secondBonus,
          total: secondTotal,
        },
      );
      if (firstTotal === secondTotal) continue;
      winner = firstTotal > secondTotal ? attack : reciprocal;
      loser = winner === attack ? reciprocal : attack;
      break;
    }
    if (!winner || !loser) throw new Error("Clash did not resolve");
    events.push({
      type: "CLASH_RESOLVED",
      stepIndex,
      winnerId: winner.player.id,
      loserId: loser.player.id,
    });
    attackPackets.push({
      attackerId: winner.player.id,
      targetId: loser.player.id,
      cardId: winner.card.id,
      damage: winner.damage,
      evadeDifficulty: winner.evadeDifficulty,
      guardPierce: winner.guardPierce,
      source: "ATTACK",
    });
    if (winner.card.effect.special === "DRAW_ON_CLASH_WIN") {
      clashWinnersToDraw.add(winner.player.id);
    }
  }

  const counterActions = activeActions
    .filter((action) => action.card.effect.kind === "COUNTER")
    .sort((left, right) => left.player.seatNumber - right.player.seatNumber);
  for (const counter of counterActions) {
    const designatedId = counter.queued.targetPlayerId!;
    const triggeringAttack = attackActions.find(
      (attack) =>
        attack.player.id === designatedId
        && attack.targetId === counter.player.id
        && !resolvedAttackers.has(attack.player.id),
    );
    if (!triggeringAttack) continue;
    resolvedAttackers.add(triggeringAttack.player.id);
    const attackerDamage = counter.card.effect.counterAttackerDamage ?? 0;
    const counterDamage = counter.card.effect.counterSelfDamage ?? 0;
    specialPackets.push(
      {
        playerId: triggeringAttack.player.id,
        damage: attackerDamage,
        source: "COUNTER",
      },
      {
        playerId: counter.player.id,
        damage: counterDamage,
        source: "COUNTER",
      },
    );
    events.push({
      type: "COUNTER_TRIGGERED",
      stepIndex,
      counterPlayerId: counter.player.id,
      attackerId: triggeringAttack.player.id,
      attackerDamage,
      counterDamage,
    });
  }

  for (const attack of attackActions) {
    if (resolvedAttackers.has(attack.player.id)) continue;
    attackPackets.push({
      attackerId: attack.player.id,
      targetId: attack.targetId,
      cardId: attack.card.id,
      damage: attack.damage,
      evadeDifficulty: attack.evadeDifficulty,
      guardPierce: attack.guardPierce,
      source: "ATTACK",
    });
  }

  for (const action of activeActions) {
    const selfDamage = action.card.effect.selfDamage ?? 0;
    if (selfDamage > 0) {
      specialPackets.push({
        playerId: action.player.id,
        damage: selfDamage,
        source: "SELF",
      });
    }
  }

  for (const evade of activeActions.filter(
    (action) => action.card.effect.kind === "EVADE",
  )) {
    const incoming = attackPackets
      .filter((packet) => packet.targetId === evade.player.id && packet.damage > 0)
      .sort(
        (left, right) =>
          findPlayer(state, left.attackerId).seatNumber
          - findPlayer(state, right.attackerId).seatNumber,
      );
    let active = true;
    for (const packet of incoming) {
      if (!active) break;
      const roll = rollDie(randomSource, "EVADE");
      const bonus = evade.card.effect.evadeRollBonus ?? 0;
      const succeeded = roll + bonus >= packet.evadeDifficulty;
      events.push({
        type: "EVADE_ROLLED",
        stepIndex,
        playerId: evade.player.id,
        attackerId: packet.attackerId,
        roll,
        bonus,
        difficulty: packet.evadeDifficulty,
        succeeded,
      });
      if (succeeded) {
        packet.damage = 0;
        continue;
      }
      packet.damage = evade.card.effect.evadeFailureDamage ?? 20;
      packet.source = "EVADE_FAILURE";
      active = false;
      events.push({ type: "EVADE_FAILED", stepIndex, playerId: evade.player.id });
    }
  }

  const attackDamageTotals = new Map<string, number>();
  for (const player of state.players) {
    const incoming = attackPackets.filter(
      (packet) => packet.targetId === player.id && packet.damage > 0,
    );
    if (incoming.length === 0) {
      attackDamageTotals.set(player.id, 0);
      continue;
    }
    const guard = activeActions.find(
      (action) =>
        action.player.id === player.id
        && (action.card.effect.kind === "GUARD"
          || action.card.effect.kind === "LAST_STAND"),
    );
    const incomingDamage = incoming.reduce((sum, packet) => sum + packet.damage, 0);
    let finalDamage = incomingDamage;
    if (guard?.card.effect.kind === "LAST_STAND") {
      events.push({
        type: "GUARD_ACTIVATED",
        stepIndex,
        playerId: player.id,
        reduction: 0,
        mode: "LAST_STAND",
      });
    } else if (guard) {
      const effect = guard.card.effect;
      if ((effect.perAttackReduction ?? 0) > 0) {
        finalDamage = incoming.reduce(
          (sum, packet) =>
            sum + (packet.source === "ATTACK"
              ? Math.max(0, packet.damage - (effect.perAttackReduction ?? 0))
              : packet.damage),
          0,
        );
        events.push({
          type: "GUARD_ACTIVATED",
          stepIndex,
          playerId: player.id,
          reduction: effect.perAttackReduction ?? 0,
          mode: "PER_ATTACK",
        });
      } else {
        const requestedReduction = effect.guardReduction ?? 0;
        const totalPierce = incoming.reduce(
          (sum, packet) => sum + packet.guardPierce,
          0,
        );
        const effectiveReduction = Math.max(0, requestedReduction - totalPierce);
        finalDamage = Math.max(0, incomingDamage - effectiveReduction);
        events.push({
          type: "GUARD_ACTIVATED",
          stepIndex,
          playerId: player.id,
          reduction: requestedReduction,
          mode: "TOTAL",
        });
        if (
          effect.special === "RETURN_IF_NO_ATTACK"
          && incomingDamage === 0
        ) {
          returnToHand.add(guard.instance.instanceId);
        }
      }
      events.push({
        type: "GUARD_RESOLVED",
        stepIndex,
        playerId: player.id,
        incomingDamage,
        reducedDamage: incomingDamage - finalDamage,
        finalDamage,
      });
    }
    attackDamageTotals.set(player.id, finalDamage);
  }

  for (const predictiveGuard of activeActions.filter(
    (action) => action.card.effect.special === "RETURN_IF_NO_ATTACK",
  )) {
    const incomingDamage = attackPackets
      .filter((packet) => packet.targetId === predictiveGuard.player.id)
      .reduce((sum, packet) => sum + packet.damage, 0);
    if (incomingDamage === 0) {
      returnToHand.add(predictiveGuard.instance.instanceId);
    }
  }

  const heals = new Map<string, number>();
  for (const action of activeActions) {
    applyUtilityAction(state, action, randomSource, events, heals);
  }
  for (const playerId of clashWinnersToDraw) {
    const player = findPlayer(state, playerId);
    const drawn = drawCards(player.deckState, 1, randomSource);
    player.deckState = drawn.state;
    appendDrawEvents(events, playerId, drawn);
  }

  const results = state.players
    .filter((player) => stepStartHp[player.id]! > 0)
    .map((player) => {
      const heal = heals.get(player.id) ?? 0;
      const healedHp = Math.min(player.maxHp, stepStartHp[player.id]! + heal);
      const attackDamage = attackDamageTotals.get(player.id) ?? 0;
      const special = specialPackets.filter((packet) => packet.playerId === player.id);
      const specialDamage = special.reduce((sum, packet) => sum + packet.damage, 0);
      const damage = attackDamage + specialDamage;
      let remainingHp = Math.max(0, healedHp - damage);
      const lastStand = activeActions.some(
        (action) =>
          action.player.id === player.id
          && action.card.effect.kind === "LAST_STAND",
      );
      const lastStandTriggered = remainingHp === 0 && lastStand;
      if (lastStandTriggered) remainingHp = HP_SCALE;
      const sources: DamageSource[] = [];
      if (attackDamage > 0) {
        const hasEvadeFailure = attackPackets.some(
          (packet) =>
            packet.targetId === player.id
            && packet.source === "EVADE_FAILURE"
            && packet.damage > 0,
        );
        sources.push(hasEvadeFailure ? "EVADE_FAILURE" : "ATTACK");
      }
      sources.push(...special.map((packet) => packet.source));
      return {
        player,
        heal,
        healedHp,
        damage,
        remainingHp,
        lastStandTriggered,
        source: sourcePriority(sources),
      };
    });

  for (const result of results) {
    if (result.heal > 0) {
      events.push({
        type: "HEAL_APPLIED",
        stepIndex,
        playerId: result.player.id,
        amount: result.heal,
        remainingHp: result.healedHp,
      });
    }
    if (result.damage > 0) {
      events.push({
        type: "DAMAGE_APPLIED",
        stepIndex,
        playerId: result.player.id,
        damage: result.damage,
        remainingHp: result.remainingHp,
        source: result.source,
      });
    }
    if (result.lastStandTriggered) {
      events.push({
        type: "LAST_STAND_TRIGGERED",
        stepIndex,
        playerId: result.player.id,
      });
    }
  }
  for (const result of results) {
    result.player.hp = result.remainingHp;
    result.player.alive = result.remainingHp > 0;
  }
  for (const result of results.filter((candidate) => !candidate.player.alive)) {
    events.push({ type: "PLAYER_DIED", stepIndex, playerId: result.player.id });
  }
  events.push({
    type: "STEP_FINISHED",
    roundNumber: state.roundNumber,
    stepIndex,
  });
}

export function resolveRound(
  state: GameState,
  randomSource: RandomSource,
): { state: GameState; events: BattleEvent[] } {
  if (state.phase !== "SELECTING_CARDS") {
    throw new GameEngineError("INVALID_GAME_PHASE");
  }
  if (!haveAllAlivePlayersConfirmed(state)) {
    throw new GameEngineError("ROUND_ALREADY_CONFIRMED");
  }
  let next = cloneGameState(state);
  next.phase = "RESOLVING_ROUND";
  const events: BattleEvent[] = [
    ...next.pendingEvents,
    {
      type: "ROUND_LOCKED",
      roundNumber: next.roundNumber,
      cardCounts: next.players
        .filter((player) => player.alive)
        .map((player) => ({
          playerId: player.id,
          count: player.deckState.queuedCards.length,
        })),
    },
  ];
  const usedCards = new Map<string, ActionCardInstance[]>();
  const returnToHand = new Set<string>();

  for (let stepIndex = 0; stepIndex < MAX_CARDS_PER_ROUND; stepIndex += 1) {
    const hasCards = next.players.some((player) =>
      player.deckState.queuedCards.some((queued) => queued.order === stepIndex)
    );
    if (!hasCards) continue;
    resolveStep(
      next,
      stepIndex,
      randomSource,
      events,
      usedCards,
      returnToHand,
    );
    if (next.players.filter((player) => player.alive).length <= 1) break;
  }

  for (const player of next.players) {
    for (const card of usedCards.get(player.id) ?? []) {
      if (returnToHand.has(card.instanceId)) player.deckState.hand.push(card);
      else player.deckState.discardPile.push(card);
    }
    player.deckState.queuedCards = [];
    player.deckState.confirmed = false;
  }
  next.pendingEvents = [];
  events.push({ type: "ROUND_FINISHED", roundNumber: next.roundNumber });

  const survivors = next.players.filter((player) => player.alive);
  if (survivors.length <= 1) {
    next.result = survivors.length === 1
      ? { type: "WINNER", winnerPlayerId: survivors[0]!.id }
      : { type: "DRAW" };
    next.phase = "FINISHED";
    events.push({ type: "GAME_FINISHED", result: next.result });
  } else if (next.roundNumber % 3 === 0) {
    next = prepareRewardOptions(next, randomSource);
  } else {
    next.phase = "ROUND_STARTING";
  }

  return { state: next, events };
}
