import { Prisma } from "#prisma/client.js";
import { prisma } from "#app/utils/db.server.ts";
import {
  DISCOVER_TRACKS_PAGE_SIZE,
  DISCOVER_SORT_OPTIONS,
  DEFAULT_DISCOVER_SORT,
  parseDiscoverSort,
  defaultDiscoverSortDirection,
  type DiscoverSortOption,
  type DiscoverTrack,
  type TrackPopularityStats,
} from "#app/utils/discover.ts";
import { type SortDirection } from "#app/utils/sort-direction.ts";
import { getTrackPopularityStats, getTrackPlayCounts } from "#app/utils/track-popularity.server.ts";

// Re-export shared types and functions for server use
export {
  DISCOVER_TRACKS_PAGE_SIZE,
  DISCOVER_SORT_OPTIONS,
  DEFAULT_DISCOVER_SORT,
  parseDiscoverSort,
  defaultDiscoverSortDirection,
  type DiscoverSortOption,
  type DiscoverTrack,
  type TrackPopularityStats,
};

const TRACK_SELECT = {
  id: true,
  title: true,
  duration: true,
  serviceUrl: true,
  createdAt: true,
  updatedAt: true,
  releaseDate: true,
  originalDate: true,
  artist: {
    select: {
      id: true,
      name: true,
    },
  },
  albumRecord: {
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

export type ListDiscoverTracksResult = {
  tracks: DiscoverTrack[];
  pagination: {
    limit: number;
    hasNext: boolean;
    nextCursor: string | null;
  };
};

export async function listDiscoverTracks({
  userId,
  sort,
  direction = defaultDiscoverSortDirection(sort),
  cursor,
  limit = DISCOVER_TRACKS_PAGE_SIZE,
}: {
  userId: string;
  sort: DiscoverSortOption;
  direction?: SortDirection;
  cursor?: string | null;
  limit?: number;
}): Promise<ListDiscoverTracksResult> {
  if (sort === "mostPlayed") {
    return listDiscoverTracksByPlayCount({ userId, direction, cursor, limit });
  }

  if (sort === "mostLiked") {
    return listDiscoverTracksByUserCount({ userId, direction, cursor, limit });
  }

  const orderBy = getOrderByForSort(sort, direction);

  const tracksRaw = await prisma.track.findMany({
    select: TRACK_SELECT,
    orderBy,
    take: limit,
    cursor: cursor ? { id: cursor } : undefined,
    skip: cursor ? 1 : undefined,
  });

  const nextCursor =
    tracksRaw.length === limit ? (tracksRaw[tracksRaw.length - 1]?.id ?? null) : null;

  const trackIds = tracksRaw.map((t) => t.id);
  const userTracks = await prisma.userTrack.findMany({
    where: {
      userId,
      trackId: { in: trackIds },
      isActive: true,
      deletedAt: null,
    },
    select: {
      trackId: true,
      createdAt: true,
    },
  });

  const userTrackMap = new Map(userTracks.map((ut) => [ut.trackId, ut.createdAt]));

  // Fetch popularity stats for all tracks
  const popularityStatsMap = await getTrackPopularityStats(trackIds, userId);

  const tracks: DiscoverTrack[] = tracksRaw.map((track) => ({
    ...track,
    isInUserLibrary: userTrackMap.has(track.id),
    userTrackCreatedAt: userTrackMap.get(track.id) ?? null,
    popularityStats: popularityStatsMap.get(track.id),
  }));

  return {
    tracks,
    pagination: {
      limit,
      hasNext: !!nextCursor,
      nextCursor,
    },
  };
}

function getOrderByForSort(
  sort: DiscoverSortOption,
  direction: SortDirection,
): Array<{ [key: string]: string | { [key: string]: string } }> {
  switch (sort) {
    case "recentlyAdded":
      return [{ createdAt: direction }, { id: direction }];
    case "titleAZ":
      return [{ title: direction }, { id: direction }];
    case "artistAZ":
      return [{ artist: { name: direction } }, { title: direction }, { id: direction }];
    default:
      return [{ createdAt: direction }, { id: direction }];
  }
}

const PLAY_COUNT_SQL = Prisma.raw(
  `SELECT trackId, COUNT(*) AS cnt FROM UsageEvent WHERE type = 'play_completed' GROUP BY trackId`,
);

const LIKE_COUNT_SQL = Prisma.raw(
  `SELECT trackId, COUNT(*) AS cnt FROM UserTrack WHERE isActive = 1 AND deletedAt IS NULL GROUP BY trackId`,
);

type AggregatePage = {
  ids: string[];
  hasNext: boolean;
  nextCursor: string | null;
};

/** Fetch full DiscoverTrack rows for an ordered page of ids (preserves order). */
async function hydrateDiscoverPage({
  userId,
  orderedIds,
}: {
  userId: string;
  orderedIds: string[];
}): Promise<DiscoverTrack[]> {
  if (orderedIds.length === 0) return [];

  const [tracksRaw, userTracks] = await Promise.all([
    prisma.track.findMany({
      where: { id: { in: orderedIds } },
      select: TRACK_SELECT,
    }),
    prisma.userTrack.findMany({
      where: {
        userId,
        trackId: { in: orderedIds },
        isActive: true,
        deletedAt: null,
      },
      select: { trackId: true, createdAt: true },
    }),
  ]);

  const userTrackMap = new Map(userTracks.map((ut) => [ut.trackId, ut.createdAt]));
  const trackMap = new Map(tracksRaw.map((t) => [t.id, t]));
  const popularityStatsMap = await getTrackPopularityStats(orderedIds, userId);

  const tracks: DiscoverTrack[] = [];
  for (const id of orderedIds) {
    const track = trackMap.get(id);
    if (!track) continue;
    tracks.push({
      ...track,
      isInUserLibrary: userTrackMap.has(id),
      userTrackCreatedAt: userTrackMap.get(id) ?? null,
      popularityStats: popularityStatsMap.get(id),
    });
  }
  return tracks;
}

/**
 * Keyset-paginated track ids ordered by an aggregate count (global plays or
 * library likes). The sort key is (count, createdAt, id); the cursor position is
 * resolved with scalar subqueries so every comparison stays inside SQL — pages
 * are O(page size) instead of loading and sorting the whole catalog in memory.
 */
async function aggregateOrderedTrackIds({
  countSql,
  direction,
  cursor,
  limit,
}: {
  countSql: Prisma.Sql;
  direction: SortDirection;
  cursor: string | null | undefined;
  limit: number;
}): Promise<AggregatePage> {
  const desc = direction !== "asc";
  const cntDir = desc ? "DESC" : "ASC";
  const createdDir = desc ? "DESC" : "ASC";
  const idDir = desc ? "ASC" : "DESC";
  const cntOp = desc ? "<" : ">";
  const createdOp = desc ? "<" : ">";
  const idOp = desc ? ">" : "<";

  const where = cursor
    ? Prisma.sql`
        COALESCE(c.cnt, 0) ${Prisma.raw(cntOp)} (
          SELECT COALESCE(c2.cnt, 0) FROM Track t2
          LEFT JOIN (${countSql}) c2 ON c2.trackId = t2.id
          WHERE t2.id = ${cursor}
        )
        OR (
          COALESCE(c.cnt, 0) = (
            SELECT COALESCE(c2.cnt, 0) FROM Track t2
            LEFT JOIN (${countSql}) c2 ON c2.trackId = t2.id
            WHERE t2.id = ${cursor}
          )
          AND t.createdAt ${Prisma.raw(createdOp)} (
            SELECT t2.createdAt FROM Track t2 WHERE t2.id = ${cursor}
          )
        )
        OR (
          COALESCE(c.cnt, 0) = (
            SELECT COALESCE(c2.cnt, 0) FROM Track t2
            LEFT JOIN (${countSql}) c2 ON c2.trackId = t2.id
            WHERE t2.id = ${cursor}
          )
          AND t.createdAt = (SELECT t2.createdAt FROM Track t2 WHERE t2.id = ${cursor})
          AND t.id ${Prisma.raw(idOp)} ${cursor}
        )
      `
    : Prisma.sql`1 = 1`;

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT t.id
    FROM Track t
    LEFT JOIN (${countSql}) c ON c.trackId = t.id
    WHERE ${where}
    ORDER BY
      COALESCE(c.cnt, 0) ${Prisma.raw(cntDir)},
      t.createdAt ${Prisma.raw(createdDir)},
      t.id ${Prisma.raw(idDir)}
    LIMIT ${limit + 1}
  `;

  const hasNext = rows.length > limit;
  const page = hasNext ? rows.slice(0, limit) : rows;
  const nextCursor = hasNext ? (page[page.length - 1]?.id ?? null) : null;
  return { ids: page.map((row) => row.id), hasNext, nextCursor };
}

async function listDiscoverTracksByPlayCount({
  userId,
  direction,
  cursor,
  limit,
}: {
  userId: string;
  direction: SortDirection;
  cursor: string | null | undefined;
  limit: number;
}): Promise<ListDiscoverTracksResult> {
  const { ids, hasNext, nextCursor } = await aggregateOrderedTrackIds({
    countSql: PLAY_COUNT_SQL,
    direction,
    cursor,
    limit,
  });

  const tracks = await hydrateDiscoverPage({ userId, orderedIds: ids });

  return {
    tracks,
    pagination: { limit, hasNext, nextCursor },
  };
}

async function listDiscoverTracksByUserCount({
  userId,
  direction,
  cursor,
  limit,
}: {
  userId: string;
  direction: SortDirection;
  cursor: string | null | undefined;
  limit: number;
}): Promise<ListDiscoverTracksResult> {
  const { ids, hasNext, nextCursor } = await aggregateOrderedTrackIds({
    countSql: LIKE_COUNT_SQL,
    direction,
    cursor,
    limit,
  });

  const tracks = await hydrateDiscoverPage({ userId, orderedIds: ids });

  return {
    tracks,
    pagination: { limit, hasNext, nextCursor },
  };
}

const PLAYABLE_TRACK_WHERE = { audioFiles: { some: {} } } as const;

const SPINE_TRACK_SELECT = {
  id: true,
  title: true,
  createdAt: true,
  artist: { select: { id: true, name: true } },
} as const;

/**
 * Full playable Discover catalog in the same order as the Discover page.
 * Tracks without audio are omitted so playback can continue through the list.
 */
export async function listDiscoverSpineTracks({
  sort,
  direction = defaultDiscoverSortDirection(sort),
}: {
  sort: DiscoverSortOption;
  direction?: SortDirection;
}) {
  if (sort === "mostPlayed" || sort === "mostLiked") {
    const tracks = await prisma.track.findMany({
      where: PLAYABLE_TRACK_WHERE,
      select: SPINE_TRACK_SELECT,
    });
    const ids = tracks.map((track) => track.id);
    const counts =
      sort === "mostPlayed" ? await getTrackPlayCounts(ids) : await discoverLibraryCounts(ids);

    const sorted = [...tracks].sort((a, b) => {
      const countA = counts.get(a.id) ?? 0;
      const countB = counts.get(b.id) ?? 0;
      if (countB !== countA) return countB - countA;
      const timeDiff = b.createdAt.getTime() - a.createdAt.getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.id.localeCompare(b.id);
    });
    const ordered = direction === "asc" ? sorted.reverse() : sorted;
    return ordered.map(({ id, title, artist }) => ({ id, title, artist }));
  }

  const tracks = await prisma.track.findMany({
    where: PLAYABLE_TRACK_WHERE,
    select: SPINE_TRACK_SELECT,
    orderBy: getOrderByForSort(sort, direction),
  });
  return tracks.map(({ id, title, artist }) => ({ id, title, artist }));
}

async function discoverLibraryCounts(trackIds: string[]) {
  if (trackIds.length === 0) return new Map<string, number>();
  const userCounts = await prisma.userTrack.groupBy({
    by: ["trackId"],
    where: { trackId: { in: trackIds }, isActive: true, deletedAt: null },
    _count: { userId: true },
  });
  return new Map(userCounts.map((row) => [row.trackId, row._count.userId]));
}
