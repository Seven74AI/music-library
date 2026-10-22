import { describe, expect, test } from "vitest";
import {
  activityAction,
  activityMatter,
  activitySummary,
  activityToCsv,
  assignRanks,
  completenessPercent,
  cumulativeCompleteness,
  DASHBOARD_METRICS_TTL_MS,
  formatActivityLine,
  lastNDays,
  paginateNewest,
  periodStart,
} from "./dashboard.ts";

describe("dashboard calculations", () => {
  test("caches metrics for 5 minutes", () => {
    expect(DASHBOARD_METRICS_TTL_MS).toBe(5 * 60 * 1000);
  });

  test("completeness is the share of filled metadata fields", () => {
    expect(completenessPercent(0, 0)).toBe(0);
    expect(completenessPercent(2, 10)).toBe(100);
    expect(completenessPercent(2, 6)).toBe(60);
  });

  test("period start uses UTC day, week, and month boundaries", () => {
    const friday = new Date("2026-10-02T18:30:00.000Z");
    expect(periodStart("all", friday)).toBeNull();
    expect(periodStart("today", friday)?.toISOString()).toBe("2026-10-02T00:00:00.000Z");
    expect(periodStart("week", friday)?.toISOString()).toBe("2026-09-28T00:00:00.000Z");
    expect(periodStart("month", friday)?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    const sunday = new Date("2026-10-04T05:00:00.000Z");
    expect(periodStart("week", sunday)?.toISOString()).toBe("2026-09-28T00:00:00.000Z");
  });

  test("ranks ties without skipping later curators incorrectly", () => {
    const ranked = assignRanks([
      { id: "a", editCount: 5 },
      { id: "b", editCount: 5 },
      { id: "c", editCount: 1 },
    ]);
    expect(ranked.map((row) => row.rank)).toEqual([1, 1, 3]);
  });

  test("classifies edits, merges, and splits", () => {
    expect(activityAction("typo")).toBe("edited");
    expect(activityAction("Merged into Queen: duplicate")).toBe("merged");
    expect(activityAction("SPLIT: moved side project")).toBe("split");
    expect(activityAction('CREATED via split from "Queen": side project')).toBe("split");
  });

  test("activity matter keeps the edit comment and reads a split", () => {
    expect(activityMatter("Fixed the credit")).toBe("Fixed the credit");
    expect(activityMatter("SPLIT: side project")).toBe("Split: side project");
    expect(activityMatter("  ")).toBeNull();
    expect(activityMatter(null)).toBeNull();
  });

  test("formats the live activity line", () => {
    const now = new Date("2026-10-02T12:02:00.000Z");
    const summary = activitySummary({ name: "Alice", username: "alice" }, "edited", "Track X");
    expect(summary).toBe("Alice edited 'Track X'");
    expect(formatActivityLine(summary, new Date("2026-10-02T12:00:00.000Z"), now)).toBe(
      "Alice edited 'Track X' (2 minutes ago)",
    );
  });

  test("builds a cumulative completeness series", () => {
    const days = lastNDays(2, new Date("2026-10-02T12:00:00.000Z"));
    const series = cumulativeCompleteness(
      [
        { day: "2026-10-01", created: 1, filled: 5 },
        { day: "2026-10-02", created: 1, filled: 1 },
      ],
      days,
    );
    expect(series).toEqual([
      { date: "2026-10-01", percent: 100 },
      { date: "2026-10-02", percent: 60 },
    ]);
  });

  test("paginates merged sources newest first", () => {
    const page = paginateNewest(
      [
        [
          { id: "a", at: 3 },
          { id: "b", at: 1 },
        ],
        [{ id: "c", at: 2 }],
      ],
      1,
      2,
      (item) => item.at,
      (item) => item.id,
    );
    expect(page.map((item) => item.id)).toEqual(["a", "c"]);
  });

  test("escapes csv fields", () => {
    const csv = activityToCsv([
      {
        id: "track:1",
        action: "edited",
        entityType: "track",
        entityId: "1",
        entityName: 'Track "X"',
        summary: "Alice edited 'Track \"X\"'",
        message: "unused",
        matter: null,
        createdAt: "2026-10-02T12:00:00.000Z",
        curator: { id: "u", username: "alice", name: "Alice" },
      },
    ]);
    expect(csv).toContain('"Track ""X"""');
    expect(csv.startsWith("timestamp,curator,action,entityType,entityName,summary\n")).toBe(true);
  });
});
