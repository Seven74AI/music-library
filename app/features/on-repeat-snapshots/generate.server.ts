import { USAGE_EVENT_TYPES } from "#app/features/usage-analytics/record-usage.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import {
  ON_REPEAT_SNAPSHOT_CAP,
  getPreviousCalendarMonthUtc,
  yearMonthToUtcWindow,
} from "./month.ts";

/** Duck-typed so we don't depend on Prisma runtime internals for one error code. */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export type RankedPlayCompletedTrack = {
  trackId: string;
  listenCount: number;
  lastCompletedAt: Date;
};

/**
 * Rank distinct tracks by `play_completed` count in `[windowStart, windowEndExclusive)`.
 * Tie-break: most recent completed play, then `trackId` ascending.
 */
export async function rankPlayCompletedTracks({
  userId,
  windowStart,
  windowEndExclusive,
  limit = ON_REPEAT_SNAPSHOT_CAP,
}: {
  userId: string;
  windowStart: Date;
  windowEndExclusive: Date;
  limit?: number;
}): Promise<RankedPlayCompletedTrack[]> {
  const events = await prisma.usageEvent.findMany({
    where: {
      userId,
      type: USAGE_EVENT_TYPES.play_completed,
      trackId: { not: null },
      createdAt: { gte: windowStart, lt: windowEndExclusive },
    },
    select: { trackId: true, createdAt: true },
  });

  const byTrack = new Map<string, { listenCount: number; lastCompletedAt: Date }>();
  for (const event of events) {
    const trackId = event.trackId;
    if (!trackId) continue;
    const existing = byTrack.get(trackId);
    if (!existing) {
      byTrack.set(trackId, { listenCount: 1, lastCompletedAt: event.createdAt });
      continue;
    }
    existing.listenCount += 1;
    if (event.createdAt > existing.lastCompletedAt) {
      existing.lastCompletedAt = event.createdAt;
    }
  }

  return [...byTrack.entries()]
    .map(([trackId, stats]) => ({
      trackId,
      listenCount: stats.listenCount,
      lastCompletedAt: stats.lastCompletedAt,
    }))
    .sort((a, b) => {
      if (b.listenCount !== a.listenCount) return b.listenCount - a.listenCount;
      if (b.lastCompletedAt.getTime() !== a.lastCompletedAt.getTime()) {
        return b.lastCompletedAt.getTime() - a.lastCompletedAt.getTime();
      }
      return a.trackId.localeCompare(b.trackId);
    })
    .slice(0, limit);
}

export type GenerateSnapshotResult =
  | { status: "created"; snapshotId: string }
  | { status: "skipped_empty" }
  | { status: "already_exists"; snapshotId: string };

export async function generateOnRepeatSnapshotForUser({
  userId,
  yearMonth,
  windowStart,
  windowEndExclusive,
}: {
  userId: string;
  yearMonth: string;
  windowStart: Date;
  windowEndExclusive: Date;
}): Promise<GenerateSnapshotResult> {
  const existing = await prisma.onRepeatSnapshot.findUnique({
    where: { userId_yearMonth: { userId, yearMonth } },
    select: { id: true },
  });
  if (existing) {
    return { status: "already_exists", snapshotId: existing.id };
  }

  const ranked = await rankPlayCompletedTracks({
    userId,
    windowStart,
    windowEndExclusive,
  });

  if (ranked.length === 0) {
    return { status: "skipped_empty" };
  }

  // Drop dangling track IDs (track deleted) before persisting.
  const existingTracks = await prisma.track.findMany({
    where: { id: { in: ranked.map((row) => row.trackId) } },
    select: { id: true },
  });
  const existingIds = new Set(existingTracks.map((t) => t.id));
  const members = ranked.filter((row) => existingIds.has(row.trackId));

  if (members.length === 0) {
    return { status: "skipped_empty" };
  }

  try {
    const snapshot = await prisma.onRepeatSnapshot.create({
      data: {
        userId,
        yearMonth,
        tracks: {
          create: members.map((row, position) => ({
            trackId: row.trackId,
            position,
            listenCount: row.listenCount,
          })),
        },
      },
      select: { id: true },
    });
    return { status: "created", snapshotId: snapshot.id };
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      const raced = await prisma.onRepeatSnapshot.findUnique({
        where: { userId_yearMonth: { userId, yearMonth } },
        select: { id: true },
      });
      if (raced) {
        return { status: "already_exists", snapshotId: raced.id };
      }
    }
    throw error;
  }
}

export type GenerateMonthSummary = {
  yearMonth: string;
  created: number;
  skippedEmpty: number;
  alreadyExists: number;
};

/**
 * Generate On-Repeat Snapshots for the previous calendar month relative to `asOf`
 * (typically the 1st of the month when cron runs).
 */
export async function generateOnRepeatSnapshotsForMonth({
  asOf = new Date(),
  yearMonth: yearMonthOverride,
}: {
  asOf?: Date;
  /** Optional explicit month (`YYYY-MM`) instead of previous month from `asOf`. */
  yearMonth?: string;
} = {}): Promise<GenerateMonthSummary> {
  const window = yearMonthOverride
    ? yearMonthToUtcWindow(yearMonthOverride)
    : getPreviousCalendarMonthUtc(asOf);

  const usersWithCompletes = await prisma.usageEvent.findMany({
    where: {
      type: USAGE_EVENT_TYPES.play_completed,
      userId: { not: null },
      trackId: { not: null },
      createdAt: { gte: window.windowStart, lt: window.windowEndExclusive },
    },
    select: { userId: true },
    distinct: ["userId"],
  });

  let created = 0;
  let skippedEmpty = 0;
  let alreadyExists = 0;

  for (const row of usersWithCompletes) {
    if (!row.userId) continue;
    const result = await generateOnRepeatSnapshotForUser({
      userId: row.userId,
      yearMonth: window.yearMonth,
      windowStart: window.windowStart,
      windowEndExclusive: window.windowEndExclusive,
    });
    if (result.status === "created") created += 1;
    else if (result.status === "skipped_empty") skippedEmpty += 1;
    else alreadyExists += 1;
  }

  return {
    yearMonth: window.yearMonth,
    created,
    skippedEmpty,
    alreadyExists,
  };
}
