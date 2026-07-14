import { MAX_DIE_ROLL, MIN_DIE_ROLL } from "./constants";
import type { RandomSource } from "./random";
import { rollDie } from "./random";
import type { BattleEvent, PlayerState } from "./types";

export type InitiativeResult = {
  players: PlayerState[];
  actionOrder: string[];
  events: BattleEvent[];
};

export function rollInitiative(
  players: readonly PlayerState[],
  turnStartHp: Readonly<Record<string, number>>,
  randomSource: RandomSource,
): InitiativeResult {
  const events: BattleEvent[] = [];
  const rolledPlayers: PlayerState[] = players.map((player) => {
    if (!player.alive) {
      return { ...player, speedRoll: null, hiddenTieRoll: null };
    }
    const speed = rollDie(randomSource, "SPEED");
    events.push({ type: "SPEED_ROLLED", playerId: player.id, speed });
    return { ...player, speedRoll: speed, hiddenTieRoll: null };
  });

  const groups = new Map<number, PlayerState[]>();
  for (const player of rolledPlayers) {
    if (!player.alive || player.speedRoll === null) continue;
    const group = groups.get(player.speedRoll) ?? [];
    group.push(player);
    groups.set(player.speedRoll, group);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const assignmentOrder = [...group].sort((left, right) => {
      const hpDifference = turnStartHp[left.id]! - turnStartHp[right.id]!;
      if (hpDifference !== 0) return hpDifference;
      const nicknameDifference = left.nickname.localeCompare(right.nickname);
      return nicknameDifference !== 0
        ? nicknameDifference
        : left.seatNumber - right.seatNumber;
    });
    const available = Array.from(
      { length: MAX_DIE_ROLL - MIN_DIE_ROLL + 1 },
      (_, index) => index + MIN_DIE_ROLL,
    );
    for (const player of assignmentOrder) {
      const selectedIndex = randomSource.nextInt(
        1,
        available.length,
        "HIDDEN_TIE",
      ) - 1;
      const [hiddenRoll] = available.splice(selectedIndex, 1);
      const target = rolledPlayers.find((candidate) => candidate.id === player.id)!;
      target.hiddenTieRoll = hiddenRoll!;
    }
  }

  const actionOrder = rolledPlayers
    .filter((player) => player.alive)
    .sort((left, right) => {
      const speedDifference = right.speedRoll! - left.speedRoll!;
      if (speedDifference !== 0) return speedDifference;
      const hiddenDifference =
        (right.hiddenTieRoll ?? 0) - (left.hiddenTieRoll ?? 0);
      return hiddenDifference !== 0
        ? hiddenDifference
        : left.seatNumber - right.seatNumber;
    })
    .map((player) => player.id);

  return { players: rolledPlayers, actionOrder, events };
}
