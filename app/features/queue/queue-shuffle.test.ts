import { describe, expect, test } from "vitest";
import { createShuffledOrder, fisherYatesShuffle, reshuffleFromCurrent } from "./queue-shuffle.ts";

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

  test("returns shuffled order when shuffle is enabled", () => {
    expect(createShuffledOrder(4, true, () => 0.5)).toHaveLength(4);
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
});
