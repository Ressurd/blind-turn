import { MAX_DIE_ROLL, MIN_DIE_ROLL } from "./constants";

export type RandomContext =
  | "CLASH"
  | "EVADE"
  | "DECK"
  | "REWARD"
  | "INSERT";

export interface RandomSource {
  nextInt(min: number, max: number, context?: RandomContext): number;
  shuffle<T>(items: readonly T[]): T[];
}

function assertRange(min: number, max: number): void {
  if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
    throw new Error(`Invalid random range: ${min}..${max}`);
  }
}

export class ProductionRandomSource implements RandomSource {
  nextInt(min: number, max: number): number {
    assertRange(min, max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  shuffle<T>(items: readonly T[]): T[] {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = this.nextInt(0, index);
      [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
    }
    return result;
  }
}

export class SeededRandomSource implements RandomSource {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  nextInt(min: number, max: number): number {
    assertRange(min, max);
    this.state = (Math.imul(this.state, 1_664_525) + 1_013_904_223) >>> 0;
    const fraction = this.state / 0x1_0000_0000;
    return Math.floor(fraction * (max - min + 1)) + min;
  }

  shuffle<T>(items: readonly T[]): T[] {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = this.nextInt(0, index);
      [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
    }
    return result;
  }
}

type ContextSequences = Partial<Record<RandomContext, readonly number[]>>;

export class SequenceRandomSource implements RandomSource {
  private readonly globalSequence: readonly number[];
  private readonly contextSequences: ContextSequences;
  private readonly cursors = new Map<RandomContext | "GLOBAL", number>();

  constructor(
    sequence: readonly number[] | ContextSequences,
    private readonly fallback?: RandomSource,
  ) {
    const usesGlobalSequence = Array.isArray(sequence);
    this.globalSequence = usesGlobalSequence
      ? (sequence as readonly number[])
      : [];
    this.contextSequences = usesGlobalSequence
      ? {}
      : (sequence as ContextSequences);
  }

  nextInt(min: number, max: number, context?: RandomContext): number {
    assertRange(min, max);
    const contextual = context ? this.contextSequences[context] : undefined;
    const key = contextual ? context! : "GLOBAL";
    const source = contextual ?? this.globalSequence;
    const cursor = this.cursors.get(key) ?? 0;

    if (cursor >= source.length) {
      if (this.fallback) {
        return this.fallback.nextInt(min, max, context);
      }
      throw new Error(
        `SequenceRandomSource ran out of values${context ? ` for ${context}` : ""}`,
      );
    }

    const value = source[cursor]!;
    this.cursors.set(key, cursor + 1);
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(`Sequence value ${value} is outside ${min}..${max}`);
    }
    return value;
  }

  shuffle<T>(items: readonly T[]): T[] {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = this.nextInt(0, index);
      [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
    }
    return result;
  }
}

export function rollDie(
  randomSource: RandomSource,
  context: RandomContext,
): number {
  return randomSource.nextInt(MIN_DIE_ROLL, MAX_DIE_ROLL, context);
}
