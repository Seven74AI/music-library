/**
 * Object key naming and retention selection for SQLite backups in Tigris.
 *
 * Layout:
 * - backups/sqlite/daily/YYYY-MM-DD.db
 * - backups/sqlite/weekly/YYYY-Www.db  (ISO week)
 */

export const DAILY_PREFIX = "backups/sqlite/daily/";
export const WEEKLY_PREFIX = "backups/sqlite/weekly/";

export const DAILY_RETENTION = 7;
export const WEEKLY_RETENTION = 4;

/** Format a Date as UTC YYYY-MM-DD. */
export function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * ISO week string YYYY-Www in UTC (week starts Monday, week 1 has Jan 4).
 * Matches the common ISO-8601 week-date convention.
 */
export function formatUtcIsoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Thursday in current week decides the year
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  const week = String(weekNo).padStart(2, "0");
  return `${d.getUTCFullYear()}-W${week}`;
}

export function dailyBackupKey(date: Date): string {
  return `${DAILY_PREFIX}${formatUtcDate(date)}.db`;
}

export function weeklyBackupKey(date: Date): string {
  return `${WEEKLY_PREFIX}${formatUtcIsoWeek(date)}.db`;
}

/**
 * Given sorted-newest-first object keys under a prefix, return keys to delete
 * beyond the retention count.
 */
export function keysToPrune(keysNewestFirst: string[], retain: number): string[] {
  if (retain < 0) throw new Error("retain must be >= 0");
  if (keysNewestFirst.length <= retain) return [];
  return keysNewestFirst.slice(retain);
}

/** Sort backup object keys newest-first by the date/week segment in the key. */
export function sortBackupKeysNewestFirst(keys: string[]): string[] {
  return [...keys].sort((a, b) => b.localeCompare(a));
}
