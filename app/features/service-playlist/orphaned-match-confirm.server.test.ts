import { describe, expect, test } from "vitest";
import { getDuplicateMatchedTrackIds, orphanMatchesSchema } from "./orphaned-match-confirm.server";

describe("getDuplicateMatchedTrackIds", () => {
  test("returns empty when each matched track is unique", () => {
    expect(
      getDuplicateMatchedTrackIds([
        { action: "match", selectedTrackId: "t1" },
        { action: "match", selectedTrackId: "t2" },
        { action: "new", selectedTrackId: null },
        { action: "skip", selectedTrackId: null },
      ]),
    ).toEqual([]);
  });

  test("returns track ids selected more than once", () => {
    expect(
      getDuplicateMatchedTrackIds([
        { action: "match", selectedTrackId: "t1" },
        { action: "match", selectedTrackId: "t2" },
        { action: "match", selectedTrackId: "t1" },
      ]),
    ).toEqual(["t1"]);
  });
});

describe("orphanMatchesSchema", () => {
  test("accepts a valid array", () => {
    expect(
      orphanMatchesSchema.safeParse([
        {
          action: "new",
          deletedItemId: "abc",
          selectedTrackId: null,
          position: 0,
        },
        { action: "skip", position: 2 },
      ]).success,
    ).toBe(true);
  });

  test("rejects an oversized array", () => {
    const big = Array.from({ length: 201 }, (_, i) => ({
      action: "skip",
      position: i,
    }));
    expect(orphanMatchesSchema.safeParse(big).success).toBe(false);
  });

  test("treats an empty-string deletedItemId as omitted", () => {
    const parsed = orphanMatchesSchema.safeParse([
      { action: "new", position: 1, deletedItemId: "" },
    ]);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.[0]?.deletedItemId).toBeUndefined();
  });

  test("rejects malformed entries", () => {
    expect(orphanMatchesSchema.safeParse({}).success).toBe(false);
    expect(orphanMatchesSchema.safeParse([{ action: "boom", position: 1 }]).success).toBe(false);
    expect(orphanMatchesSchema.safeParse([{ action: "new", position: -1 }]).success).toBe(false);
    expect(
      orphanMatchesSchema.safeParse([
        { action: "new", position: 1, deletedItemId: "x".repeat(129) },
      ]).success,
    ).toBe(false);
  });
});
