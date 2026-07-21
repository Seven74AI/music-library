export type RandomFn = () => number;

const defaultRandom: RandomFn = () => Math.random();

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
  random: RandomFn = defaultRandom,
): number[] {
  if (length === 0) return [];
  if (!isShuffleEnabled) return Array.from({ length }, (_, index) => index);
  return fisherYatesShuffle(length, random);
}

/**
 * Reshuffle spine play order from the current position onward.
 * Indices before `currentPosition` are preserved (already played / current).
 */
export function reshuffleFromCurrent(
  order: number[],
  currentPosition: number,
  random: RandomFn = defaultRandom,
): number[] {
  if (order.length <= 1 || currentPosition >= order.length - 1) {
    return [...order];
  }

  const prefix = order.slice(0, currentPosition);
  const suffix = order.slice(currentPosition);
  const reshuffledSuffix = fisherYatesShuffle(suffix.length, random).map((index) => suffix[index]!);

  return [...prefix, ...reshuffledSuffix];
}
