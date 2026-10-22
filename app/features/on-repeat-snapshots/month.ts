/**
 * UTC calendar-month helpers for On-Repeat Snapshots (ADR-024).
 * Month boundaries align with DailyUsageStat UTC day boundaries.
 */

/** Format a Date as `YYYY-MM` using UTC year/month. */
export function formatYearMonth(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Parse `YYYY-MM` into an exclusive UTC window
 * `[windowStart, windowEndExclusive)`.
 */
export function yearMonthToUtcWindow(yearMonth: string): {
  yearMonth: string;
  windowStart: Date;
  windowEndExclusive: Date;
} {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (!match) {
    throw new Error(`Invalid yearMonth: ${yearMonth}`);
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) {
    throw new Error(`Invalid yearMonth: ${yearMonth}`);
  }
  const windowStart = new Date(Date.UTC(year, monthIndex, 1));
  const windowEndExclusive = new Date(Date.UTC(year, monthIndex + 1, 1));
  return { yearMonth, windowStart, windowEndExclusive };
}

/**
 * Previous calendar month relative to `asOf` (UTC).
 * Example: asOf = 1 Oct 2026 → September 2026.
 */
export function getPreviousCalendarMonthUtc(asOf: Date = new Date()): {
  yearMonth: string;
  windowStart: Date;
  windowEndExclusive: Date;
} {
  const windowStart = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - 1, 1));
  const windowEndExclusive = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1));
  return {
    yearMonth: formatYearMonth(windowStart),
    windowStart,
    windowEndExclusive,
  };
}

/** Human-readable month label, e.g. "September 2026". */
export function formatYearMonthLabel(yearMonth: string): string {
  const { windowStart } = yearMonthToUtcWindow(yearMonth);
  return windowStart.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export const ON_REPEAT_SNAPSHOT_CAP = 30;
export const ON_REPEAT_SHELF_SIZE = 3;
