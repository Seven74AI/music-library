import { prisma } from "#app/utils/db.server.ts";

export const USAGE_EVENT_TYPES = {
  signup: "signup",
  login: "login",
  library_add: "library_add",
  play_started: "play_started",
  play_completed: "play_completed",
} as const;

export type UsageEventType = (typeof USAGE_EVENT_TYPES)[keyof typeof USAGE_EVENT_TYPES];

export const USAGE_METRICS = {
  signups: "signups",
  logins: "logins",
  library_adds: "library_adds",
  plays_started: "plays_started",
  plays_completed: "plays_completed",
  dau: "dau",
} as const;

export type UsageMetric = (typeof USAGE_METRICS)[keyof typeof USAGE_METRICS];

const EVENT_TO_METRIC: Record<UsageEventType, UsageMetric> = {
  signup: USAGE_METRICS.signups,
  login: USAGE_METRICS.logins,
  library_add: USAGE_METRICS.library_adds,
  play_started: USAGE_METRICS.plays_started,
  play_completed: USAGE_METRICS.plays_completed,
};

/**
 * Signup counts here because it creates a session without emitting a login
 * event — without it, a user who joins and never returns is missing from DAU.
 */
const DAU_EVENT_TYPES = new Set<UsageEventType>([
  USAGE_EVENT_TYPES.signup,
  USAGE_EVENT_TYPES.login,
  USAGE_EVENT_TYPES.play_started,
  USAGE_EVENT_TYPES.play_completed,
]);

/** Duck-typed so we don't depend on Prisma runtime internals for one error code. */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** UTC midnight for the given instant (defaults to now). */
export function getUtcDayStart(date: Date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dailyMetricUpsert(day: Date, metric: UsageMetric, by: number) {
  return prisma.dailyUsageStat.upsert({
    where: { day_metric: { day, metric } },
    create: { day, metric, value: by },
    update: { value: { increment: by } },
  });
}

async function incrementDailyMetric(day: Date, metric: UsageMetric, by = 1) {
  if (by <= 0) return;
  await dailyMetricUpsert(day, metric, by);
}

async function maybeIncrementDau(day: Date, userId: string, type: UsageEventType) {
  if (!DAU_EVENT_TYPES.has(type)) return;

  // The dedupe row and the counter must land together: a dedupe row written
  // without its increment would suppress every future retry for that day.
  try {
    await prisma.$transaction([
      prisma.dailyActiveUser.create({ data: { day, userId } }),
      dailyMetricUpsert(day, USAGE_METRICS.dau, 1),
    ]);
  } catch (error) {
    if (isUniqueConstraintViolation(error)) return; // already counted for this UTC day
    throw error;
  }
}

export async function recordUsageEvent({
  type,
  userId,
  trackId,
  playId,
  meta,
  amount = 1,
}: {
  type: UsageEventType;
  userId?: string | null;
  trackId?: string | null;
  /** Correlation ID linking a play's `play_started` and `play_completed` events. */
  playId?: string | null;
  meta?: Record<string, unknown> | null;
  /** How much to add to the daily metric (default 1). */
  amount?: number;
}): Promise<void> {
  const day = getUtcDayStart();

  await prisma.usageEvent.create({
    data: {
      type,
      userId: userId ?? null,
      trackId: trackId ?? null,
      playId: playId ?? null,
      meta: meta ? JSON.stringify(meta) : null,
    },
  });

  await incrementDailyMetric(day, EVENT_TO_METRIC[type], amount);

  if (userId) {
    await maybeIncrementDau(day, userId, type);
  }
}
