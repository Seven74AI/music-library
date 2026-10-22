import { describe, expect, test } from "vitest";
import { earnedBadgeTypes, type CuratorCounts, EMPTY_CURATOR_COUNTS } from "./badges.ts";

function counts(partial: Partial<CuratorCounts>): CuratorCounts {
  return { ...EMPTY_CURATOR_COUNTS, ...partial };
}

describe("curator badge thresholds", () => {
  test("9 edits does not award Getting Started and 10 does", () => {
    expect(earnedBadgeTypes(counts({ edits: 9 }))).not.toContain("getting_started");
    expect(earnedBadgeTypes(counts({ edits: 9 }))).toContain("first_edit");
    expect(earnedBadgeTypes(counts({ edits: 10 }))).toEqual(
      expect.arrayContaining(["first_edit", "getting_started"]),
    );
  });

  test("edit tiers start at their exact counts", () => {
    expect(earnedBadgeTypes(counts({ edits: 0 }))).toEqual([]);
    expect(earnedBadgeTypes(counts({ edits: 1 }))).toEqual(["first_edit"]);
    expect(earnedBadgeTypes(counts({ edits: 49 }))).not.toContain("regular_contributor");
    expect(earnedBadgeTypes(counts({ edits: 50 }))).toContain("regular_contributor");
    expect(earnedBadgeTypes(counts({ edits: 199 }))).not.toContain("power_curator");
    expect(earnedBadgeTypes(counts({ edits: 200 }))).toContain("power_curator");
    expect(earnedBadgeTypes(counts({ edits: 499 }))).not.toContain("master_curator");
    expect(earnedBadgeTypes(counts({ edits: 500 }))).toContain("master_curator");
    expect(earnedBadgeTypes(counts({ edits: 999 }))).not.toContain("elite_curator");
    expect(earnedBadgeTypes(counts({ edits: 1000 }))).toContain("elite_curator");
  });

  test("merge, queue, genre, and report badges use their own counts", () => {
    expect(earnedBadgeTypes(counts({ merges: 9 }))).not.toContain("duplicate_hunter");
    expect(earnedBadgeTypes(counts({ merges: 10 }))).toContain("duplicate_hunter");
    expect(earnedBadgeTypes(counts({ queueResolutions: 49 }))).not.toContain("quality_guardian");
    expect(earnedBadgeTypes(counts({ queueResolutions: 50 }))).toContain("quality_guardian");
    expect(earnedBadgeTypes(counts({ genreEdits: 99 }))).not.toContain("genre_specialist");
    expect(earnedBadgeTypes(counts({ genreEdits: 100 }))).toContain("genre_specialist");
    expect(earnedBadgeTypes(counts({ resolvedUserReports: 9 }))).not.toContain("community_helper");
    expect(earnedBadgeTypes(counts({ resolvedUserReports: 10 }))).toContain("community_helper");
  });
});
