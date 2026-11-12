import { describe, expect, test } from "vitest";
import {
  confirmOrphanedMatches,
  getDuplicateDeletedItemIds,
  getDuplicateMatchedTrackIds,
  orphanMatchesSchema,
} from "./orphaned-match-confirm.server";

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
      { action: "skip", position: 1, deletedItemId: "" },
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

describe("orphanMatchesSchema cross-field validation and bounds", () => {
  test("rejects match without selectedTrackId", () => {
    expect(orphanMatchesSchema.safeParse([{ action: "match", position: 0 }]).success).toBe(false);
  });

  test("accepts new without deletedItemId (itemId-less flow)", () => {
    expect(orphanMatchesSchema.safeParse([{ action: "new", position: 0 }]).success).toBe(true);
  });

  test("accepts valid match and new", () => {
    expect(
      orphanMatchesSchema.safeParse([
        { action: "match", selectedTrackId: "t1", position: 0 },
        { action: "new", deletedItemId: "d1", position: 1 },
      ]).success,
    ).toBe(true);
  });

  test("rejects position over 100000", () => {
    expect(orphanMatchesSchema.safeParse([{ action: "skip", position: 100001 }]).success).toBe(
      false,
    );
  });

  test("rejects selectedTrackId over 128 chars", () => {
    expect(
      orphanMatchesSchema.safeParse([
        { action: "match", selectedTrackId: "a".repeat(129), position: 0 },
      ]).success,
    ).toBe(false);
  });
});

describe("getDuplicateDeletedItemIds", () => {
  test("returns duplicated ids only", () => {
    expect(
      getDuplicateDeletedItemIds([
        { action: "new", deletedItemId: "d1" },
        { action: "match", deletedItemId: "d2" },
        { action: "new", deletedItemId: "d1" },
        { action: "new", deletedItemId: undefined },
        { action: "new", deletedItemId: undefined },
      ]),
    ).toEqual(["d1"]);
  });

  test("ignores skip rows sharing an id", () => {
    expect(
      getDuplicateDeletedItemIds([
        { action: "skip", deletedItemId: "d1" },
        { action: "new", deletedItemId: "d1" },
        { action: "skip", deletedItemId: "d1" },
      ]),
    ).toEqual([]);
  });

  test("confirmOrphanedMatches rejects duplicates before touching the DB", async () => {
    const result = await confirmOrphanedMatches(
      "p1",
      [
        { action: "new", deletedItemId: "d1", position: 0 },
        { action: "new", deletedItemId: "d1", position: 1 },
      ],
      "u1",
    );
    expect(result).toEqual({
      success: false,
      processedCount: 0,
      message: "Each deleted video can only be used once.",
      error: "Duplicate deleted video selections: d1",
      status: 400,
    });
  });
});
