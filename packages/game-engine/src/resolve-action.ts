import {
  CRITICAL_DAMAGE,
  NORMAL_DAMAGE,
  REDUCED_DAMAGE,
} from "./constants";
import { resolveClashRolls } from "./clash";
import { applyDamage } from "./damage";
import type { RandomSource } from "./random";
import { rollDie } from "./random";
import type { BattleEvent, GameState, PlayerState } from "./types";

export type TurnResolutionContext = {
  state: GameState;
  events: BattleEvent[];
  randomSource: RandomSource;
};

function findPlayer(state: GameState, playerId: string): PlayerState {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error(`Unknown player: ${playerId}`);
  return player;
}

function damagePlayer(
  context: TurnResolutionContext,
  player: PlayerState,
  damage: number,
): void {
  const result = applyDamage(player, damage);
  Object.assign(player, result.player);
  context.events.push({
    type: "DAMAGE_APPLIED",
    playerId: player.id,
    damage,
    remainingHp: player.hp,
  });
  if (result.died) {
    context.events.push({ type: "PLAYER_DIED", playerId: player.id });
  }
}

function damagePlayersSimultaneously(
  context: TurnResolutionContext,
  first: PlayerState,
  firstDamage: number,
  second: PlayerState,
  secondDamage: number,
): void {
  const firstResult = applyDamage(first, firstDamage);
  const secondResult = applyDamage(second, secondDamage);
  Object.assign(first, firstResult.player);
  Object.assign(second, secondResult.player);
  context.events.push(
    {
      type: "DAMAGE_APPLIED",
      playerId: first.id,
      damage: firstDamage,
      remainingHp: first.hp,
    },
    {
      type: "DAMAGE_APPLIED",
      playerId: second.id,
      damage: secondDamage,
      remainingHp: second.hp,
    },
  );
  if (firstResult.died) {
    context.events.push({ type: "PLAYER_DIED", playerId: first.id });
  }
  if (secondResult.died) {
    context.events.push({ type: "PLAYER_DIED", playerId: second.id });
  }
}

function isMutualAttack(attacker: PlayerState, target: PlayerState): boolean {
  return (
    !target.actionResolved &&
    target.selectedAction?.type === "ATTACK" &&
    target.selectedAction.targetPlayerId === attacker.id
  );
}

function resolveClash(
  context: TurnResolutionContext,
  attacker: PlayerState,
  target: PlayerState,
): void {
  const clash = resolveClashRolls(attacker.id, target.id, context.randomSource);
  context.events.push(...clash.events);
  attacker.actionResolved = true;
  target.actionResolved = true;
  attacker.facingTargetId = target.id;
  target.facingTargetId = attacker.id;
  const loser = clash.loserId === attacker.id ? attacker : target;
  damagePlayer(context, loser, NORMAL_DAMAGE);
}

function resolveAttack(
  context: TurnResolutionContext,
  attacker: PlayerState,
  targetPlayerId: string,
): void {
  const target = findPlayer(context.state, targetPlayerId);
  if (!target.alive) {
    attacker.actionResolved = true;
    context.events.push({
      type: "ACTION_SKIPPED",
      playerId: attacker.id,
      reason: "TARGET_DEAD",
    });
    return;
  }

  context.events.push({
    type: "ATTACK_STARTED",
    attackerId: attacker.id,
    targetId: target.id,
  });

  if (isMutualAttack(attacker, target)) {
    resolveClash(context, attacker, target);
    return;
  }

  attacker.actionResolved = true;
  attacker.facingTargetId = target.id;

  if (target.activeCounterTargetId === attacker.id) {
    target.activeCounterTargetId = null;
    context.events.push({
      type: "COUNTER_TRIGGERED",
      counterPlayerId: target.id,
      attackerId: attacker.id,
    });
    damagePlayersSimultaneously(
      context,
      attacker,
      CRITICAL_DAMAGE,
      target,
      REDUCED_DAMAGE,
    );
    return;
  }

  if (target.activeEvade) {
    const attackerSpeed = attacker.speedRoll ?? 0;
    const evadeRoll = rollDie(context.randomSource, "EVADE");
    context.events.push({
      type: "EVADE_ROLLED",
      playerId: target.id,
      attackerId: attacker.id,
      roll: evadeRoll,
      attackerSpeed,
    });
    if (evadeRoll > attackerSpeed) {
      context.events.push({ type: "EVADE_SUCCEEDED", playerId: target.id });
      return;
    }
    target.activeEvade = false;
    context.events.push({ type: "EVADE_FAILED", playerId: target.id });
    damagePlayer(context, target, CRITICAL_DAMAGE);
    return;
  }

  if (target.activeDefense) {
    damagePlayer(context, target, REDUCED_DAMAGE);
    return;
  }

  const isExposed =
    target.actionResolved &&
    target.selectedAction?.type === "ATTACK" &&
    target.facingTargetId !== attacker.id;
  if (isExposed) {
    context.events.push({
      type: "EXPOSED_ATTACK",
      attackerId: attacker.id,
      targetId: target.id,
    });
    damagePlayer(context, target, CRITICAL_DAMAGE);
    return;
  }

  damagePlayer(context, target, NORMAL_DAMAGE);
}

export function resolvePlayerAction(
  context: TurnResolutionContext,
  playerId: string,
): void {
  const player = findPlayer(context.state, playerId);
  if (!player.alive) {
    player.actionResolved = true;
    context.events.push({
      type: "ACTION_SKIPPED",
      playerId,
      reason: "DEAD",
    });
    return;
  }
  if (player.actionResolved) {
    context.events.push({
      type: "ACTION_SKIPPED",
      playerId,
      reason: "ACTION_ALREADY_CONSUMED",
    });
    return;
  }
  const action = player.selectedAction;
  if (!action) throw new Error(`Player ${playerId} has not submitted an action`);

  context.events.push({
    type: "ACTION_STARTED",
    playerId,
    actionType: action.type,
  });

  switch (action.type) {
    case "ATTACK":
      resolveAttack(context, player, action.targetPlayerId);
      break;
    case "DEFEND":
      player.actionResolved = true;
      player.activeDefense = true;
      player.facingTargetId = null;
      context.events.push({ type: "DEFENSE_ACTIVATED", playerId });
      break;
    case "EVADE":
      player.actionResolved = true;
      player.activeEvade = true;
      player.facingTargetId = null;
      context.events.push({ type: "EVADE_ACTIVATED", playerId });
      break;
    case "COUNTER":
      player.actionResolved = true;
      player.activeCounterTargetId = action.targetPlayerId;
      player.facingTargetId = null;
      context.events.push({
        type: "COUNTER_ACTIVATED",
        playerId,
        targetPlayerId: action.targetPlayerId,
      });
      break;
    case "PASS":
      player.actionResolved = true;
      player.facingTargetId = null;
      break;
  }
}
