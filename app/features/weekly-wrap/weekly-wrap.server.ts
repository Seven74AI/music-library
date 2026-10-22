import {
  USAGE_EVENT_TYPES,
  getUtcDayStart,
} from "#app/features/usage-analytics/record-usage.server.ts";
import { prisma } from "#app/utils/db.server.ts";

export type WeeklyWrapSummary = {
  finishes: number;
  uniqueTracks: number;
  /** Present only when the consecutive-day streak ending today is greater than 1. */
  dayStreak: number | null;
};

export type WeekEvent = {
  trackId: string | null;
  createdAt: Date;
};

/** UTC Monday 00:00 through next Monday 00:00 (exclusive end) for the week containing `date`. */
export function getUtcWeekRange(date: Date = new Date()): { start: Date; end: Date } {
  const day = date.getUTCDay(); // 0 = Sunday … 6 = Saturday
  const daysFromMonday = (day + 6) % 7;
  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysFromMonday),
  );
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return { start, end };
}

/** `YYYY-MM-DD` key for a UTC calendar day. */
export function utcDayKey(date: Date): string {
  return getUtcDayStart(date).toISOString().slice(0, 10);
}

/**
 * Consecutive UTC days ending today with activity. Returns 0 when today has none.
 */
export function countDayStreak(activeDayKeys: ReadonlySet<string>, now: Date = new Date()): number {
  let streak = 0;
  const cursor = getUtcDayStart(now);
  while (activeDayKeys.has(utcDayKey(cursor))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

export function summarizeWeeklyWrap({
  weekEvents,
  activeDayKeys,
  now,
}: {
  weekEvents: WeekEvent[];
  activeDayKeys: ReadonlySet<string>;
  now: Date;
  weekStart: Date;
  weekEnd: Date;
}): WeeklyWrapSummary | null {
  if (weekEvents.length === 0) return null;

  const uniqueTracks = new Set(
    weekEvents.map((event) => event.trackId).filter((id): id is string => Boolean(id)),
  ).size;

  const streak = countDayStreak(activeDayKeys, now);

  return {
    finishes: weekEvents.length,
    uniqueTracks,
    dayStreak: streak > 1 ? streak : null,
  };
}

/** How far before the week start to look for streak continuity. */
const STREAK_LOOKBACK_DAYS = 366;

/**
 * Quiet weekly listening summary for the current UTC Mon–Sun week.
 * Returns `null` when the week has zero `play_completed` finishes (hide when empty).
 */
export async function getWeeklyWrap(
  userId: string,
  now: Date = new Date(),
): Promise<WeeklyWrapSummary | null> {
  const { start, end } = getUtcWeekRange(now);
  const lookbackStart = new Date(start);
  lookbackStart.setUTCDate(lookbackStart.getUTCDate() - STREAK_LOOKBACK_DAYS);

  const events = await prisma.usageEvent.findMany({
    where: {
      userId,
      type: USAGE_EVENT_TYPES.play_completed,
      createdAt: { gte: lookbackStart, lt: end },
    },
    select: { trackId: true, createdAt: true },
  });

  const weekEvents = events.filter((event) => event.createdAt >= start && event.createdAt < end);
  const activeDayKeys = new Set(events.map((event) => utcDayKey(event.createdAt)));

  return summarizeWeeklyWrap({
    weekEvents,
    activeDayKeys,
    now,
    weekStart: start,
    weekEnd: end,
  });
}
