import { Prisma } from "#prisma/client.js";
import { type QueueTrack } from "#app/types/frontend/shared.ts";
import { USAGE_EVENT_TYPES } from "#app/features/usage-analytics/record-usage.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { LIBRARY_TRACKS_PAGE_SIZE } from "#app/utils/library-tracks-pagination.ts";
import { buildLibraryUserTracksWhere } from "#app/utils/library-user-tracks.server.ts";
import { type SortDirection } from "#app/utils/sort-direction.ts";
import {
  defaultLibrarySortDirection,
  librarySortToWindow,
  sortByPlayCompletedCount,
  type HeavyRotationWindow,
  type LibrarySortOption,
} from "./heavy-rotation.ts";
import { getPlayCompletedCountsByTrack } from "./play-completed-counts.server.ts";
import { getUtcMonthEndExclusive, getUtcMonthStart } from "./utc-month.ts";

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

/** Most-played cursor: frozen play count + stable userTrack id. */
type MostPlayedCursor = { count: number; id: string };

function encodeMostPlayedCursor(cursor: MostPlayedCursor): string {
  return Buffer.from(JSON.stringify({ v: 1, ...cursor })).toString("base64url");
}

function decodeMostPlayedCursor(raw: string): MostPlayedCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      v?: unknown;
      count?: unknown;
      id?: unknown;
    };
    if (
      parsed?.v !== 1 ||
      typeof parsed.count !== "number" ||
      !Number.isFinite(parsed.count) ||
      typeof parsed.id !== "string"
    ) {
      return null;
    }
    return { count: parsed.count, id: parsed.id };
  } catch {
    return null;
  }
}

/**
 * Keyset-paginated library page ordered by (play_completed count, userTrack
 * createdAt, userTrack id). The count is recomputed on read (ADR-026) but is
 * FROZEN into the cursor at page time, so a play landing between page requests
 * cannot shift the boundary and re-serve/skip rows — only the immutable
 * (createdAt, id) secondary keys are re-read. Ordering happens inside SQLite
 * (which can spill a large sort to disk), so the Node process only ever
 * materializes the page: O(page size) in memory, not O(library size).
 */
async function listMostPlayedLibraryPage({
  userId,
  window,
  direction,
  hasAudioOnly,
  genreId,
  cursor,
  limit,
  now,
}: {
  userId: string;
  window: HeavyRotationWindow;
  direction: SortDirection;
  hasAudioOnly: boolean;
  genreId: string | null;
  cursor: string | null | undefined;
  limit: number;
  now: Date;
}): Promise<{ ids: string[]; hasNext: boolean; nextCursor: string | null }> {
  const desc = direction !== "asc";
  const cntDir = desc ? "DESC" : "ASC";
  const cntOp = desc ? "<" : ">";

  const countSql = Prisma.sql`
    SELECT "trackId", COUNT(*) AS cnt
    FROM "UsageEvent"
    WHERE "userId" = ${userId}
      AND type = ${USAGE_EVENT_TYPES.play_completed}
      AND "trackId" IS NOT NULL
      ${
        window === "month"
          ? Prisma.sql`AND "createdAt" >= ${getUtcMonthStart(now)} AND "createdAt" < ${getUtcMonthEndExclusive(now)}`
          : Prisma.empty
      }
    GROUP BY "trackId"
  `;

  const baseWhere = Prisma.sql`
    ut."userId" = ${userId}
    AND ut."isActive" = 1
    AND ut."deletedAt" IS NULL
    ${
      hasAudioOnly
        ? Prisma.sql`AND EXISTS (SELECT 1 FROM "TrackAudioFile" taf WHERE taf."trackId" = ut."trackId")`
        : Prisma.empty
    }
    ${
      genreId
        ? Prisma.sql`AND EXISTS (SELECT 1 FROM "_TrackGenres" tg WHERE tg."A" = ${genreId} AND tg."B" = ut."trackId")`
        : Prisma.empty
    }
  `;

  const cursorKey = cursor ? decodeMostPlayedCursor(cursor) : null;
  const cursorWhere = cursorKey
    ? Prisma.sql`AND (
        COALESCE(c.cnt, 0) ${Prisma.raw(cntOp)} ${cursorKey.count}
        OR (
          COALESCE(c.cnt, 0) = ${cursorKey.count}
          AND ut."createdAt" < (SELECT u2."createdAt" FROM "UserTrack" u2 WHERE u2."id" = ${cursorKey.id})
        )
        OR (
          COALESCE(c.cnt, 0) = ${cursorKey.count}
          AND ut."createdAt" = (SELECT u2."createdAt" FROM "UserTrack" u2 WHERE u2."id" = ${cursorKey.id})
          AND ut."id" > ${cursorKey.id}
        )
      )`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<
    Array<{ id: string; cnt: number | bigint; createdAt: Date }>
  >`
    SELECT ut."id", COALESCE(c.cnt, 0) AS cnt, ut."createdAt" AS "createdAt"
    FROM "UserTrack" ut
    LEFT JOIN (${countSql}) c ON c."trackId" = ut."trackId"
    WHERE ${baseWhere} ${cursorWhere}
    ORDER BY
      COALESCE(c.cnt, 0) ${Prisma.raw(cntDir)},
      ut."createdAt" DESC,
      ut."id" ASC
    LIMIT ${limit + 1}
  `;

  const hasNext = rows.length > limit;
  const page = hasNext ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor =
    hasNext && last ? encodeMostPlayedCursor({ count: Number(last.cnt), id: last.id }) : null;

  return { ids: page.map((row) => row.id), hasNext, nextCursor };
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

  const { ids: pageIds, hasNext, nextCursor } = await listMostPlayedLibraryPage({
    userId,
    window,
    direction,
    hasAudioOnly,
    genreId: genreId?.trim() || null,
    cursor,
    limit,
    now,
  });

  if (pageIds.length === 0) {
    return {
      userTracks: [],
      pagination: { limit, hasNext: false, nextCursor: null },
    };
  }

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
