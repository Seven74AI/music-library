import { expect, test } from "vitest";
import {
  dailyBackupKey,
  formatUtcDate,
  formatUtcIsoWeek,
  keysToPrune,
  sortBackupKeysNewestFirst,
  weeklyBackupKey,
  DAILY_RETENTION,
  WEEKLY_RETENTION,
} from "./backup-keys.ts";

test("formatUtcDate uses UTC calendar day", () => {
  expect(formatUtcDate(new Date("2026-09-28T01:00:00.000Z"))).toBe("2026-09-28");
  expect(formatUtcDate(new Date("2026-09-28T23:59:59.999Z"))).toBe("2026-09-28");
});

test("formatUtcIsoWeek returns ISO week for known dates", () => {
  // 2026-01-01 is Thursday → week 1 of 2026
  expect(formatUtcIsoWeek(new Date("2026-01-01T12:00:00.000Z"))).toBe("2026-W01");
  // 2026-09-28 is Monday → week 40 of 2026
  expect(formatUtcIsoWeek(new Date("2026-09-28T12:00:00.000Z"))).toBe("2026-W40");
});

test("daily and weekly keys use expected prefixes", () => {
  const d = new Date("2026-09-28T03:00:00.000Z");
  expect(dailyBackupKey(d)).toBe("backups/sqlite/daily/2026-09-28.db");
  expect(weeklyBackupKey(d)).toBe("backups/sqlite/weekly/2026-W40.db");
});

test("keysToPrune keeps the newest N and returns the rest", () => {
  const keys = [
    "backups/sqlite/daily/2026-09-28.db",
    "backups/sqlite/daily/2026-09-27.db",
    "backups/sqlite/daily/2026-09-26.db",
    "backups/sqlite/daily/2026-09-25.db",
  ];
  expect(keysToPrune(keys, 3)).toEqual(["backups/sqlite/daily/2026-09-25.db"]);
  expect(keysToPrune(keys, DAILY_RETENTION)).toEqual([]);
  expect(keysToPrune(keys, 0)).toEqual(keys);
});

test("sortBackupKeysNewestFirst is lexicographic descending", () => {
  const keys = [
    "backups/sqlite/daily/2026-09-26.db",
    "backups/sqlite/daily/2026-09-28.db",
    "backups/sqlite/daily/2026-09-27.db",
  ];
  expect(sortBackupKeysNewestFirst(keys)).toEqual([
    "backups/sqlite/daily/2026-09-28.db",
    "backups/sqlite/daily/2026-09-27.db",
    "backups/sqlite/daily/2026-09-26.db",
  ]);
});

test("weekly retention constant is 4", () => {
  expect(WEEKLY_RETENTION).toBe(4);
  expect(DAILY_RETENTION).toBe(7);
});
