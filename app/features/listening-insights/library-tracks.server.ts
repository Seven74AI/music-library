import { type QueueTrack } from "#app/types/frontend/shared.ts";
import { prisma } from "#app/utils/db.server.ts";
import { LIBRARY_TRACKS_PAGE_SIZE } from "#app/utils/library-tracks-pagination.ts";
import { buildLibraryUserTracksWhere } from "#app/utils/library-user-tracks.server.ts";
import { type SortDirection } from "#app/utils/sort-direction.ts";
import {
  defaultLibrarySortDirection,
  librarySortToWindow,
  sortByPlayCompletedCount,
  type LibrarySortOption,
} from "./heavy-rotation.ts";
import { getPlayCompletedCountsByTrack } from "./play-completed-counts.server.ts";

const QUEUE_TRACK_SELECT = {
  id: true,
  title: true,
  artist: {
    select: {
      id: true,
      name: true,
    },
  },
} as const;

const FULL_TRACK_INCLUDE = {
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
  albumRecord: {
    select: {
      id: true,
      name: true,
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

const LIBRARY_TRACK_SELECT = {
  id: true,
  createdAt: true,
  updatedAt: true,
  releaseDate: true,
  originalDate: true,
  title: true,
  duration: true,
  serviceUrl: true,
  ...FULL_TRACK_INCLUDE,
} as const;

async function curatorNoteCountsByTrackId(trackIds: string[]) {
  const counts = new Map<string, number>();
  if (trackIds.length === 0) return counts;

  const groups = await prisma.curatorNote.groupBy({
    by: ["entityId"],
    where: {
      entityType: "track",
      entityId: { in: trackIds },
    },
    _count: { _all: true },
  });

  for (const group of groups) {
    counts.set(group.entityId, group._count._all);
  }

  return counts;
}

function withCuratorNoteCounts<T extends { track: { id: string } }>(
  rows: T[],
  counts: Map<string, number>,
) {
  return rows.map((row) => ({
    ...row,
    track: {
      ...row.track,
      curatorNotesCount: counts.get(row.track.id) ?? 0,
    },
  }));
}

export type ListLibraryUserTracksResult = {
  userTracks: Array<{
    id: string;
    createdAt: Date;
    track: {
      id: string;
      title: string;
      artist: { id: string; name: string };
      duration: number | null;
      coverImage: { objectKey: string } | null;
      serviceUrl: string | null;
      createdAt: Date;
      updatedAt: Date;
      releaseDate: Date | null;
      originalDate: Date | null;
      service: { name: string; displayName: string; logoUrl: string | null } | null;
      audioFiles: Array<{ id: string; format: string | null; objectKey: string }>;
      curatorNotesCount: number;
    };
  }>;
  pagination: {
    limit: number;
    hasNext: boolean;
    nextCursor: string | null;
  };
};

/**
 * Full library spine for the audio queue (ADR-015 + ADR-026).
 * Same ordering as the library page for the chosen sort; playable-only by default.
 */
export async function listLibraryQueueSpineTracks({
  userId,
  sort,
  direction = defaultLibrarySortDirection(sort),
  hasAudioOnly = true,
  now = new Date(),
}: {
  userId: string;
  sort: LibrarySortOption;
  direction?: SortDirection;
  hasAudioOnly?: boolean;
  now?: Date;
}): Promise<QueueTrack[]> {
  const where = buildLibraryUserTracksWhere({ userId, hasAudioOnly });
  const window = librarySortToWindow(sort);

  if (!window) {
    const userTracks = await prisma.userTrack.findMany({
      where,
      select: {
        track: { select: QUEUE_TRACK_SELECT },
      },
      orderBy: [{ createdAt: direction }, { id: direction }],
    });
    return userTracks.map((userTrack) => userTrack.track);
  }

  const counts = await getPlayCompletedCountsByTrack({ userId, window, now });
  const sortable = await prisma.userTrack.findMany({
    where,
    select: {
      id: true,
      trackId: true,
      createdAt: true,
      track: { select: QUEUE_TRACK_SELECT },
    },
  });

  return sortByPlayCompletedCount(sortable, counts, direction).map((row) => row.track);
}

/**
 * Personal library page with optional Heavy Rotation sorts (ADR-026).
 * Most-played sorts reorder the **full** library (no 50 cap); pagination only.
 */
export async function listLibraryUserTracks({
  userId,
  sort,
  direction = defaultLibrarySortDirection(sort),
  hasAudioOnly = false,
  genreId = null,
  cursor,
  limit = LIBRARY_TRACKS_PAGE_SIZE,
  now = new Date(),
}: {
  userId: string;
  sort: LibrarySortOption;
  direction?: SortDirection;
  hasAudioOnly?: boolean;
  genreId?: string | null;
  cursor?: string | null;
  limit?: number;
  now?: Date;
}): Promise<ListLibraryUserTracksResult> {
  const where = buildLibraryUserTracksWhere({ userId, hasAudioOnly, genreId });
  const window = librarySortToWindow(sort);

  if (!window) {
    const userTracksRaw = await prisma.userTrack.findMany({
      where,
      select: {
        id: true,
        createdAt: true,
        track: { select: LIBRARY_TRACK_SELECT },
      },
      orderBy: [{ createdAt: direction }, { id: direction }],
      take: limit,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : undefined,
    });

    const nextCursor =
      userTracksRaw.length === limit ? (userTracksRaw[userTracksRaw.length - 1]?.id ?? null) : null;
    const noteCounts = await curatorNoteCountsByTrackId(userTracksRaw.map((row) => row.track.id));

    return {
      userTracks: withCuratorNoteCounts(userTracksRaw, noteCounts),
      pagination: {
        limit,
        hasNext: !!nextCursor,
        nextCursor,
      },
    };
  }

  const counts = await getPlayCompletedCountsByTrack({ userId, window, now });

  const sortable = await prisma.userTrack.findMany({
    where,
    select: { id: true, trackId: true, createdAt: true },
  });

  const ordered = sortByPlayCompletedCount(sortable, counts, direction);

  let start = 0;
  if (cursor) {
    const idx = ordered.findIndex((row) => row.id === cursor);
    start = idx >= 0 ? idx + 1 : 0;
  }

  const page = ordered.slice(start, start + limit);
  const hasNext = start + limit < ordered.length;
  const nextCursor = hasNext ? (page[page.length - 1]?.id ?? null) : null;

  if (page.length === 0) {
    return {
      userTracks: [],
      pagination: { limit, hasNext: false, nextCursor: null },
    };
  }

  const pageIds = page.map((row) => row.id);
  const hydrated = await prisma.userTrack.findMany({
    where: { id: { in: pageIds } },
    select: {
      id: true,
      createdAt: true,
      track: { select: LIBRARY_TRACK_SELECT },
    },
  });
  const byId = new Map(hydrated.map((row) => [row.id, row]));
  const userTracks = pageIds
    .map((id) => byId.get(id))
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  const noteCounts = await curatorNoteCountsByTrackId(userTracks.map((row) => row.track.id));

  return {
    userTracks: withCuratorNoteCounts(userTracks, noteCounts),
    pagination: {
      limit,
      hasNext,
      nextCursor,
    },
  };
}
