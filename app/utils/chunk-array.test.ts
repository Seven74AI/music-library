import { describe, expect, test } from "vitest";
import { chunkArray, SQLITE_IN_CHUNK_SIZE } from "./chunk-array";

describe("chunkArray", () => {
  test("splits arrays into chunks of the default size", () => {
    const items = Array.from({ length: 1200 }, (_, i) => i);
    const chunks = chunkArray(items);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(SQLITE_IN_CHUNK_SIZE);
    expect(chunks[1]).toHaveLength(SQLITE_IN_CHUNK_SIZE);
    expect(chunks[2]).toHaveLength(200);
  });

  test("returns empty array for empty input", () => {
    expect(chunkArray([])).toEqual([]);
  });

  test("returns single chunk when input is smaller than chunk size", () => {
    expect(chunkArray(["a", "b", "c"])).toEqual([["a", "b", "c"]]);
  });
});
