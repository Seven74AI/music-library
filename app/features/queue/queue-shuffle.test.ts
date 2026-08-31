import { describe, expect, test } from "vitest";
import {
  createSeededRandom,
  createShuffledOrder,
  fisherYatesShuffle,
  reshuffleFromCurrent,
} from "./queue-shuffle.ts";

describe("createSeededRandom", () => {
  test("returns values in [0, 1)", () => {
    const random = createSeededRandom(42);
    for (let i = 0; i < 1000; i += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  test("is deterministic for the same seed", () => {
    const a = createSeededRandom(7);
    const b = createSeededRandom(7);
    for (let i = 0; i < 20; i += 1) {
      expect(a()).toBe(b());
    }
  });

  test("produces different sequences for different seeds", () => {
    const a = createSeededRandom(1);
    const b = createSeededRandom(2);
    const sequenceA = Array.from({ length: 10 }, () => a());
    const sequenceB = Array.from({ length: 10 }, () => b());
    expect(sequenceA).not.toEqual(sequenceB);
  });
});

describe("fisherYatesShuffle", () => {
  test("returns empty array for length 0", () => {
    expect(fisherYatesShuffle(0)).toEqual([]);
  });

  test("returns [0] for length 1", () => {
    expect(fisherYatesShuffle(1)).toEqual([0]);
  });

  test("produces a permutation of all indices", () => {
    const order = fisherYatesShuffle(8, () => 0.5);
    expect(order).toHaveLength(8);
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  test("uses injectable random for deterministic output", () => {
    let call = 0;
    const rng = () => {
      call += 1;
      return call / 10;
    };

    expect(fisherYatesShuffle(4, rng)).toEqual([1, 2, 3, 0]);
  });
});

describe("createShuffledOrder", () => {
  test("returns identity order when shuffle is disabled", () => {
    expect(createShuffledOrder(4, false)).toEqual([0, 1, 2, 3]);
  });

  test("returns identity order when shuffle is disabled even with a seed", () => {
    expect(createShuffledOrder(4, false, 42)).toEqual([0, 1, 2, 3]);
  });

  test("returns shuffled order when shuffle is enabled", () => {
    expect(createShuffledOrder(4, true, () => 0.5)).toHaveLength(4);
  });

  test("produces an identical permutation for the same seed and length", () => {
    expect(createShuffledOrder(8, true, 42)).toEqual(createShuffledOrder(8, true, 42));
  });

  test("produces different permutations for different seeds", () => {
    expect(createShuffledOrder(8, true, 1)).not.toEqual(createShuffledOrder(8, true, 2));
  });

  test("produces different permutations for a different length with the same seed", () => {
    expect(createShuffledOrder(4, true, 42)).not.toEqual(createShuffledOrder(8, true, 42));
  });
});

describe("reshuffleFromCurrent", () => {
  test("preserves indices before the current position", () => {
    const order = [2, 0, 3, 1];
    const reshuffled = reshuffleFromCurrent(order, 1, () => 0.5);

    expect(reshuffled.slice(0, 2)).toEqual([2, 0]);
    expect([...reshuffled.slice(2)].sort((a, b) => a - b)).toEqual([1, 3]);
  });

  test("reshuffles only the current position when at the end", () => {
    const order = [1, 0, 2];
    const reshuffled = reshuffleFromCurrent(order, 2, () => 0.5);

    expect(reshuffled).toEqual([1, 0, 2]);
  });

  test("is deterministic for the same seed, order, and position", () => {
    const order = [2, 0, 3, 1];
    expect(reshuffleFromCurrent(order, 1, 42)).toEqual(reshuffleFromCurrent(order, 1, 42));
  });

  test("produces different results for different seeds", () => {
    const order = [2, 0, 3, 1];
    expect(reshuffleFromCurrent(order, 1, 1)).not.toEqual(reshuffleFromCurrent(order, 1, 2));
  });
});
