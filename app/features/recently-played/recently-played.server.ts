import { USAGE_EVENT_TYPES } from "#app/features/usage-analytics/record-usage.server.ts";
import { prisma } from "#app/utils/db.server.ts";

/** Cap for the listening-hub Recently Played Strip (ADR-025 / decision #62). */
export const RECENTLY_PLAYED_LIMIT = 20;

const RECENTLY_PLAYED_TRACK_SELECT = {
  id: true,
  title: true,
  duration: true,
  serviceUrl: true,
  artist: {
    select: {
      id: true,
      name: true,
    },
  },
  coverImage: {
    select: {
      objectKey: true,
    },
  },
  service: {
    select: {
      name: true,
      displayName: true,
      logoUrl: true,
    },
  },
  audioFiles: {
    select: {
      id: true,
      format: true,
      objectKey: true,
    },
  },
} as const;

export type RecentlyPlayedTrack = {
  /** When this track was most recently completed (`play_completed.createdAt`). */
  playedAt: Date;
  track: {
    id: string;
    title: string;
    duration: number | null;
    serviceUrl: string | null;
    artist: { id: string; name: string };
    coverImage: { objectKey: string } | null;
    service: { name: string; displayName: string; logoUrl: string | null } | null;
    audioFiles: Array<{ id: string; format: string | null; objectKey: string }>;
  };
};

type EventCursor = { createdAt: Date; id: string };

function playCompletedWhere(userId: string, cursor: EventCursor | null) {
  return {
    userId,
    type: USAGE_EVENT_TYPES.play_completed,
    trackId: { not: null },
    ...(cursor
      ? {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        }
      : {}),
  };
}

type CompletionEventRow = {
  id: string;
  trackId: string | null;
  createdAt: Date;
};

/**
 * Distinct tracks by latest `play_completed` UsageEvent for the listening-hub
 * Recently Played Strip. Dangling track IDs are skipped (same as `/history`).
 */
export async function getRecentlyPlayedTracks({
  userId,
  limit = RECENTLY_PLAYED_LIMIT,
}: {
  userId: string;
  limit?: number;
}): Promise<RecentlyPlayedTrack[]> {
  const result: RecentlyPlayedTrack[] = [];
  const seenTrackIds = new Set<string>();
  let pageCursor: EventCursor | null = null;
  const batchSize = Math.max(limit * 2, 40);

  // Walk completions newest-first, collapsing repeats. Re-fetch batches until
  // we have `limit` resolved tracks or run out of events (dangling IDs drop).
  while (result.length < limit) {
    const events: CompletionEventRow[] = await prisma.usageEvent.findMany({
      where: playCompletedWhere(userId, pageCursor),
      select: {
        id: true,
        trackId: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: batchSize,
    });

    if (events.length === 0) break;

    const batchCandidates: Array<{ trackId: string; playedAt: Date }> = [];
    for (const event of events) {
      if (!event.trackId || seenTrackIds.has(event.trackId)) continue;
      seenTrackIds.add(event.trackId);
      batchCandidates.push({ trackId: event.trackId, playedAt: event.createdAt });
    }

    if (batchCandidates.length > 0) {
      const tracks = await prisma.track.findMany({
        where: { id: { in: batchCandidates.map((c) => c.trackId) } },
        select: RECENTLY_PLAYED_TRACK_SELECT,
      });
      const trackById = new Map(tracks.map((track) => [track.id, track]));

      for (const candidate of batchCandidates) {
        if (result.length >= limit) break;
        const track = trackById.get(candidate.trackId);
        if (!track) continue; // dangling track id — skip
        result.push({ playedAt: candidate.playedAt, track });
      }
    }

    const lastEvent: CompletionEventRow = events[events.length - 1]!;
    pageCursor = { createdAt: lastEvent.createdAt, id: lastEvent.id };
    if (events.length < batchSize) break;
  }

  return result;
}
