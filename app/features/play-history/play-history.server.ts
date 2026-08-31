import { USAGE_EVENT_TYPES } from "#app/features/usage-analytics/record-usage.server.ts";
import { prisma } from "#app/utils/db.server.ts";

export const PLAY_HISTORY_PAGE_SIZE = 50;

const HISTORY_TRACK_SELECT = {
  id: true,
  title: true,
  artist: {
    select: {
      id: true,
      name: true,
    },
  },
  duration: true,
  coverImage: {
    select: {
      objectKey: true,
    },
  },
  serviceUrl: true,
  service: {
    select: {
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

export type PlayHistoryTrack = {
  id: string;
  title: string;
  artist: { id: string; name: string };
  duration: number | null;
  coverImage: { objectKey: string } | null;
  serviceUrl: string | null;
  service: { displayName: string; logoUrl: string | null } | null;
  audioFiles: Array<{ id: string; format: string | null; objectKey: string }>;
};

export type PlayHistoryItem = {
  /** The `play_started` UsageEvent id — unique per play, used as the row key. */
  id: string;
  /** Correlation id shared with the matching `play_completed` event, if any. */
  playId: string | null;
  /** Whether a `play_completed` event with the same `playId` exists. */
  completed: boolean;
  /** When the play started. */
  playedAt: Date;
  track: PlayHistoryTrack;
};

export type PlayHistoryCursor = { createdAt: Date; id: string };

/**
 * Cursor serialized as `<createdAtMs>_<id>`. The `id` component is the
 * tiebreaker for events that share the same millisecond `createdAt`.
 */
export function serializeHistoryCursor(cursor: PlayHistoryCursor): string {
  return `${cursor.createdAt.getTime()}_${cursor.id}`;
}

export function parseHistoryCursor(raw: string | null): PlayHistoryCursor | null {
  if (!raw) return null;
  const separator = raw.indexOf("_");
  if (separator <= 0) return null;
  const ms = Number(raw.slice(0, separator));
  const id = raw.slice(separator + 1);
  if (!Number.isFinite(ms) || !id) return null;
  return { createdAt: new Date(ms), id };
}

function playStartedWhere(userId: string, cursor: PlayHistoryCursor | null) {
  return {
    userId,
    type: USAGE_EVENT_TYPES.play_started,
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

/**
 * Lists the user's most-recently-played tracks, newest first, using cursor
 * pagination keyed on `(createdAt, id)`. Dangling track IDs (the `Track` row
 * was deleted) are skipped, and "completed" is resolved from the presence of a
 * `play_completed` event sharing the play's `playId`.
 */
export async function getPlayHistory({
  userId,
  cursor,
  limit = PLAY_HISTORY_PAGE_SIZE,
}: {
  userId: string;
  cursor?: PlayHistoryCursor | null;
  limit?: number;
}): Promise<{ items: PlayHistoryItem[]; nextCursor: string | null }> {
  const collected: PlayHistoryItem[] = [];
  let pageCursor = cursor ?? null;

  // Keep fetching until we have `limit + 1` items (proof a next page exists)
  // or we run out of events. Dangling tracks are dropped, so a single batch
  // may yield fewer items than events.
  while (collected.length <= limit) {
    const events = await prisma.usageEvent.findMany({
      where: playStartedWhere(userId, pageCursor),
      select: {
        id: true,
        playId: true,
        trackId: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    if (events.length === 0) break;

    const trackIds = [
      ...new Set(events.map((event) => event.trackId).filter((id): id is string => Boolean(id))),
    ];
    const tracks = await prisma.track.findMany({
      where: { id: { in: trackIds } },
      select: HISTORY_TRACK_SELECT,
    });
    const trackById = new Map(tracks.map((track) => [track.id, track]));

    for (const event of events) {
      if (collected.length > limit) break;
      const track = event.trackId ? trackById.get(event.trackId) : undefined;
      if (!track) continue; // dangling track id — skip
      collected.push({
        id: event.id,
        playId: event.playId,
        completed: false,
        playedAt: event.createdAt,
        track,
      });
    }

    const lastEvent = events[events.length - 1]!;
    pageCursor = { createdAt: lastEvent.createdAt, id: lastEvent.id };
  }

  const hasNext = collected.length > limit;
  const items = collected.slice(0, limit);

  const playIds = [
    ...new Set(items.map((item) => item.playId).filter((id): id is string => Boolean(id))),
  ];
  if (playIds.length > 0) {
    const completedEvents = await prisma.usageEvent.findMany({
      where: {
        userId,
        type: USAGE_EVENT_TYPES.play_completed,
        playId: { in: playIds },
      },
      select: { playId: true },
    });
    const completedPlayIds = new Set(completedEvents.map((event) => event.playId));
    for (const item of items) {
      if (item.playId && completedPlayIds.has(item.playId)) {
        item.completed = true;
      }
    }
  }

  const lastItem = items[items.length - 1];
  const nextCursor =
    hasNext && lastItem
      ? serializeHistoryCursor({ createdAt: lastItem.playedAt, id: lastItem.id })
      : null;

  return { items, nextCursor };
}
