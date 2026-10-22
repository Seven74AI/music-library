import { describe, expect, test } from "vitest";
import {
  DEFAULT_LIBRARY_SORT,
  HEAVY_ROTATION_HOME_CAP,
  compareByPlayCompletedCount,
  librarySortToWindow,
  parseLibrarySort,
  sortByPlayCompletedCount,
} from "./heavy-rotation.ts";

describe("Heavy Rotation constants", () => {
  test("home strip cap is 50", () => {
    expect(HEAVY_ROTATION_HOME_CAP).toBe(50);
  });
});

describe("parseLibrarySort", () => {
  test("defaults unknown or missing values to dateAdded", () => {
    expect(parseLibrarySort(null)).toBe(DEFAULT_LIBRARY_SORT);
    expect(parseLibrarySort(undefined)).toBe("dateAdded");
    expect(parseLibrarySort("nope")).toBe("dateAdded");
  });

  test("accepts mutually exclusive most-played options", () => {
    expect(parseLibrarySort("mostPlayedMonth")).toBe("mostPlayedMonth");
    expect(parseLibrarySort("mostPlayedEver")).toBe("mostPlayedEver");
    expect(parseLibrarySort("dateAdded")).toBe("dateAdded");
  });
});

describe("librarySortToWindow", () => {
  test("maps only the most-played sorts", () => {
    expect(librarySortToWindow("mostPlayedMonth")).toBe("month");
    expect(librarySortToWindow("mostPlayedEver")).toBe("ever");
    expect(librarySortToWindow("dateAdded")).toBeNull();
  });
});

describe("sortByPlayCompletedCount", () => {
  const rows = [
    { id: "ut-a", trackId: "t-a", createdAt: new Date("2026-01-01T00:00:00.000Z") },
    { id: "ut-b", trackId: "t-b", createdAt: new Date("2026-02-01T00:00:00.000Z") },
    { id: "ut-c", trackId: "t-c", createdAt: new Date("2026-03-01T00:00:00.000Z") },
    { id: "ut-d", trackId: "t-d", createdAt: new Date("2026-04-01T00:00:00.000Z") },
  ];

  test("orders by completed-play count descending", () => {
    const counts = new Map([
      ["t-a", 1],
      ["t-b", 5],
      ["t-c", 3],
    ]);
    expect(sortByPlayCompletedCount(rows, counts).map((r) => r.trackId)).toEqual([
      "t-b",
      "t-c",
      "t-a",
      "t-d", // zero / missing sorts last
    ]);
  });

  test("orders by completed-play count ascending when requested", () => {
    const counts = new Map([
      ["t-a", 1],
      ["t-b", 5],
      ["t-c", 3],
    ]);
    expect(sortByPlayCompletedCount(rows, counts, "asc").map((r) => r.trackId)).toEqual([
      "t-d",
      "t-a",
      "t-c",
      "t-b",
    ]);
  });

  test("places zero-count tracks after tracks with counts", () => {
    const counts = new Map([["t-a", 2]]);
    const ordered = sortByPlayCompletedCount(rows, counts);
    expect(ordered[0]?.trackId).toBe("t-a");
    expect(ordered.slice(1).map((r) => r.trackId)).toEqual(["t-d", "t-c", "t-b"]);
  });

  test("tie-breaks equal counts by createdAt desc then id asc", () => {
    const counts = new Map([
      ["t-a", 4],
      ["t-b", 4],
      ["t-c", 4],
    ]);
    // t-c newest, then t-b, then t-a; t-d has 0
    expect(sortByPlayCompletedCount(rows, counts).map((r) => r.trackId)).toEqual([
      "t-c",
      "t-b",
      "t-a",
      "t-d",
    ]);
  });

  test("compareByPlayCompletedCount is consistent with sort", () => {
    const counts = new Map([
      ["t-a", 2],
      ["t-b", 2],
    ]);
    const a = rows[0]!;
    const b = rows[1]!;
    expect(compareByPlayCompletedCount(a, b, counts)).toBeGreaterThan(0); // b newer
    expect(compareByPlayCompletedCount(b, a, counts)).toBeLessThan(0);
  });
});
