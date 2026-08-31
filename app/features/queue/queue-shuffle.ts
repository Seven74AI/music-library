export type RandomFn = () => number;

const defaultRandom: RandomFn = () => Math.random();

/**
 * Build a deterministic pseudo-random function from a 32-bit integer seed
 * (mulberry32). The returned function produces floats in [0, 1) and always
 * yields the same sequence for the same seed.
 */
export function createSeededRandom(seed: number): RandomFn {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Resolve a 32-bit seed or an injectable random function into a `RandomFn`. */
function resolveRandom(seedOrRandom: number | RandomFn): RandomFn {
  return typeof seedOrRandom === "number" ? createSeededRandom(seedOrRandom) : seedOrRandom;
}

/**
 * Fisher-Yates shuffle producing a permutation of [0, length).
 */
export function fisherYatesShuffle(length: number, random: RandomFn = defaultRandom): number[] {
  const order = Array.from({ length }, (_, index) => index);

  for (let index = order.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = order[index]!;
    order[index] = order[swapIndex]!;
    order[swapIndex] = current;
  }

  return order;
}

export function createShuffledOrder(
  length: number,
  isShuffleEnabled: boolean,
  seedOrRandom: number | RandomFn = defaultRandom,
): number[] {
  if (length === 0) return [];
  if (!isShuffleEnabled) return Array.from({ length }, (_, index) => index);
  return fisherYatesShuffle(length, resolveRandom(seedOrRandom));
}

/**
 * Reshuffle spine play order from the current position onward.
 * Indices before `currentPosition` are preserved (already played / current).
 */
export function reshuffleFromCurrent(
  order: number[],
  currentPosition: number,
  seedOrRandom: number | RandomFn = defaultRandom,
): number[] {
  if (order.length <= 1 || currentPosition >= order.length - 1) {
    return [...order];
  }

  const random = resolveRandom(seedOrRandom);
  const prefix = order.slice(0, currentPosition);
  const suffix = order.slice(currentPosition);
  const reshuffledSuffix = fisherYatesShuffle(suffix.length, random).map((index) => suffix[index]!);

  return [...prefix, ...reshuffledSuffix];
}
