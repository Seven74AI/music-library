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
import { getPlayCompletedCountsByTrack } from "#app/features/listening-insights/play-completed-counts.server.ts";
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
  now = new Date(),
}: {
  userId: string;
  sort: DiscoverSortOption;
  direction?: SortDirection;
  cursor?: string | null;
  limit?: number;
  now?: Date;
}): Promise<ListDiscoverTracksResult> {
  if (sort === "mostPlayed") {
    return listDiscoverTracksByPlayCount({ userId, direction, cursor, limit, now });
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

async function listDiscoverTracksByPlayCount({
  userId,
  direction,
  cursor,
  limit,
  now,
}: {
  userId: string;
  direction: SortDirection;
  cursor: string | null | undefined;
  limit: number;
  now: Date;
}): Promise<ListDiscoverTracksResult> {
  // Get all tracks first
  const allTracks = await prisma.track.findMany({
    select: {
      id: true,
      createdAt: true,
    },
  });

  // Get GLOBAL play counts (across all users) for sorting
  const trackIds = allTracks.map((t) => t.id);
  const counts = await getTrackPlayCounts(trackIds);

  const sorted = [...allTracks].sort((a, b) => {
    const countA = counts.get(a.id) ?? 0;
    const countB = counts.get(b.id) ?? 0;

    if (countB !== countA) return countB - countA;

    const timeDiff = b.createdAt.getTime() - a.createdAt.getTime();
    if (timeDiff !== 0) return timeDiff;

    return a.id.localeCompare(b.id);
  });

  const ordered = direction === "asc" ? sorted.reverse() : sorted;

  let start = 0;
  if (cursor) {
    const idx = ordered.findIndex((t) => t.id === cursor);
    start = idx >= 0 ? idx + 1 : 0;
  }

  const page = ordered.slice(start, start + limit);
  const hasNext = start + limit < ordered.length;
  const nextCursor = hasNext ? (page[page.length - 1]?.id ?? null) : null;

  if (page.length === 0) {
    return {
      tracks: [],
      pagination: { limit, hasNext: false, nextCursor: null },
    };
  }

  const pageIds = page.map((t) => t.id);
  const tracksRaw = await prisma.track.findMany({
    where: { id: { in: pageIds } },
    select: TRACK_SELECT,
  });

  const userTracks = await prisma.userTrack.findMany({
    where: {
      userId,
      trackId: { in: pageIds },
      isActive: true,
      deletedAt: null,
    },
    select: {
      trackId: true,
      createdAt: true,
    },
  });

  const userTrackMap = new Map(userTracks.map((ut) => [ut.trackId, ut.createdAt]));
  const trackMap = new Map(tracksRaw.map((t) => [t.id, t]));

  // Fetch popularity stats for all tracks in this page
  const popularityStatsMap = await getTrackPopularityStats(pageIds, userId);

  const tracks: DiscoverTrack[] = [];
  for (const id of pageIds) {
    const track = trackMap.get(id);
    if (track) {
      tracks.push({
        ...track,
        isInUserLibrary: userTrackMap.has(id),
        userTrackCreatedAt: userTrackMap.get(id) ?? null,
        popularityStats: popularityStatsMap.get(id),
      });
    }
  }

  return {
    tracks,
    pagination: {
      limit,
      hasNext,
      nextCursor,
    },
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
  const userCounts = await prisma.userTrack.groupBy({
    by: ["trackId"],
    where: {
      isActive: true,
      deletedAt: null,
    },
    _count: {
      userId: true,
    },
  });

  const countMap = new Map(userCounts.map((uc) => [uc.trackId, uc._count.userId]));

  const allTracks = await prisma.track.findMany({
    select: {
      id: true,
      createdAt: true,
    },
  });

  const sorted = [...allTracks].sort((a, b) => {
    const countA = countMap.get(a.id) ?? 0;
    const countB = countMap.get(b.id) ?? 0;

    if (countB !== countA) return countB - countA;

    const timeDiff = b.createdAt.getTime() - a.createdAt.getTime();
    if (timeDiff !== 0) return timeDiff;

    return a.id.localeCompare(b.id);
  });

  const ordered = direction === "asc" ? sorted.reverse() : sorted;

  let start = 0;
  if (cursor) {
    const idx = ordered.findIndex((t) => t.id === cursor);
    start = idx >= 0 ? idx + 1 : 0;
  }

  const page = ordered.slice(start, start + limit);
  const hasNext = start + limit < ordered.length;
  const nextCursor = hasNext ? (page[page.length - 1]?.id ?? null) : null;

  if (page.length === 0) {
    return {
      tracks: [],
      pagination: { limit, hasNext: false, nextCursor: null },
    };
  }

  const pageIds = page.map((t) => t.id);
  const tracksRaw = await prisma.track.findMany({
    where: { id: { in: pageIds } },
    select: TRACK_SELECT,
  });

  const userTracks = await prisma.userTrack.findMany({
    where: {
      userId,
      trackId: { in: pageIds },
      isActive: true,
      deletedAt: null,
    },
    select: {
      trackId: true,
      createdAt: true,
    },
  });

  const userTrackMap = new Map(userTracks.map((ut) => [ut.trackId, ut.createdAt]));
  const trackMap = new Map(tracksRaw.map((t) => [t.id, t]));

  // Fetch popularity stats for all tracks in this page
  const popularityStatsMap = await getTrackPopularityStats(pageIds, userId);

  const tracks: DiscoverTrack[] = [];
  for (const id of pageIds) {
    const track = trackMap.get(id);
    if (track) {
      tracks.push({
        ...track,
        isInUserLibrary: userTrackMap.has(id),
        userTrackCreatedAt: userTrackMap.get(id) ?? null,
        popularityStats: popularityStatsMap.get(id),
      });
    }
  }

  return {
    tracks,
    pagination: {
      limit,
      hasNext,
      nextCursor,
    },
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
