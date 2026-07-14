import type { RandomSource } from "./random";
import { rollDie } from "./random";
import type { BattleEvent } from "./types";

export type ClashResult = {
  winnerId: string;
  loserId: string;
  events: BattleEvent[];
};

export function resolveClashRolls(
  firstPlayerId: string,
  secondPlayerId: string,
  randomSource: RandomSource,
): ClashResult {
  const events: BattleEvent[] = [
    { type: "CLASH_STARTED", playerIds: [firstPlayerId, secondPlayerId] },
  ];

  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const firstRoll = rollDie(randomSource, "CLASH");
    const secondRoll = rollDie(randomSource, "CLASH");
    events.push(
      { type: "CLASH_ROLLED", playerId: firstPlayerId, roll: firstRoll },
      { type: "CLASH_ROLLED", playerId: secondPlayerId, roll: secondRoll },
    );
    if (firstRoll === secondRoll) continue;

    const winnerId = firstRoll > secondRoll ? firstPlayerId : secondPlayerId;
    const loserId = winnerId === firstPlayerId ? secondPlayerId : firstPlayerId;
    events.push({ type: "CLASH_RESOLVED", winnerId, loserId });
    return { winnerId, loserId, events };
  }

  throw new Error("Clash did not resolve after 1,000 rerolls");
}
