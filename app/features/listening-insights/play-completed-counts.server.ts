import { USAGE_EVENT_TYPES } from "#app/features/usage-analytics/record-usage.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { type HeavyRotationWindow } from "./heavy-rotation.ts";
import { getUtcMonthEndExclusive, getUtcMonthStart } from "./utc-month.ts";

export type { HeavyRotationWindow };

/**
 * Live `play_completed` counts by trackId for Heavy Rotation windows.
 * Recomputed on read — not persisted snapshots (ADR-026).
 */
export async function getPlayCompletedCountsByTrack({
  userId,
  window,
  now = new Date(),
}: {
  userId: string;
  window: HeavyRotationWindow;
  now?: Date;
}): Promise<Map<string, number>> {
  const createdAtFilter =
    window === "month"
      ? {
          gte: getUtcMonthStart(now),
          lt: getUtcMonthEndExclusive(now),
        }
      : undefined;

  const groups = await prisma.usageEvent.groupBy({
    by: ["trackId"],
    where: {
      userId,
      type: USAGE_EVENT_TYPES.play_completed,
      trackId: { not: null },
      ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
    },
    _count: { _all: true },
  });

  const counts = new Map<string, number>();
  for (const group of groups) {
    if (!group.trackId) continue;
    counts.set(group.trackId, group._count._all);
  }
  return counts;
}
