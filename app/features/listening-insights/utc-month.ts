/**
 * UTC calendar-month helpers for Heavy Rotation “this month” windows.
 * Boundaries match DailyUsageStat / getUtcDayStart day semantics (UTC).
 */

/** Inclusive start of the UTC calendar month containing `date`. */
export function getUtcMonthStart(date: Date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** Exclusive end of the UTC calendar month containing `date` (start of next month). */
export function getUtcMonthEndExclusive(date: Date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}
