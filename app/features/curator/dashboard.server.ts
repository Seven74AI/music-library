import { cache, cachified } from "#app/utils/cache.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { awardCuratorBadges, badgesForCurators } from "./badges.server.ts";
import {
  ACTIVITY_EXPORT_LIMIT,
  ACTIVITY_PAGE_SIZE,
  DASHBOARD_METRICS_CACHE_KEY,
  DASHBOARD_METRICS_TTL_MS,
  activityAction,
  activityMatter,
  activitySummary,
  assignRanks,
  completenessPercent,
  cumulativeCompleteness,
  curatorLabel,
  describeTrackIssues,
  fieldPercent,
  formatActivityLine,
  issueTypeLabel,
  lastNDays,
  paginateNewest,
  periodStart,
  type ActivityEntityType,
  type ActivityItem,
  type ActivityResult,
  type CuratorRef,
  type DashboardCharts,
  type DashboardMetrics,
  type LeaderboardPeriod,
  type LeaderboardResult,
} from "./dashboard.ts";

const DAY_EXPR = (column: string) =>
  `CASE WHEN typeof(${column}) = 'integer' THEN date(${column} / 1000, 'unixepoch') ELSE date(${column}) END`;

function asNumber(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return 0;
}

export async function computeDashboardMetrics(now = new Date()): Promise<DashboardMetrics> {
  const [
    totalTracks,
    tracksMissingMetadata,
    fieldRows,
    pendingQueueItems,
    exact,
    fuzzy,
    problemRows,
  ] = await Promise.all([
    prisma.track.count(),
    prisma.track.count({
      where: {
        OR: [{ albumId: null }, { genre: null }, { genre: "" }],
      },
    }),
    prisma.$queryRawUnsafe<
      {
        withAlbum: unknown;
        withGenre: unknown;
        withYear: unknown;
        withBpm: unknown;
      }[]
    >(`
        SELECT
          SUM(CASE WHEN albumId IS NOT NULL THEN 1 ELSE 0 END) as withAlbum,
          SUM(CASE WHEN genre IS NOT NULL AND trim(genre) != '' THEN 1 ELSE 0 END) as withGenre,
          SUM(CASE WHEN year IS NOT NULL THEN 1 ELSE 0 END) as withYear,
          SUM(CASE WHEN bpm IS NOT NULL THEN 1 ELSE 0 END) as withBpm
        FROM Track
      `),
    prisma.reviewQueueItem.count({
      where: { status: { in: ["open", "claimed"] } },
    }),
    prisma.duplicateDetection.count({
      where: { status: "pending", matchType: "exact" },
    }),
    prisma.duplicateDetection.count({
      where: { status: "pending", matchType: "fuzzy" },
    }),
    prisma.$queryRawUnsafe<
      {
        id: string;
        title: string;
        artistName: string;
        albumId: string | null;
        genre: string | null;
        year: number | null;
        bpm: number | null;
        queueIssues: unknown;
        issueCount: unknown;
      }[]
    >(`
        SELECT * FROM (
          SELECT
            t.id as id,
            t.title as title,
            a.name as artistName,
            t.albumId as albumId,
            t.genre as genre,
            t.year as year,
            t.bpm as bpm,
            (
              SELECT COUNT(*)
              FROM ReviewQueueItem r
              WHERE r.entityType = 'track'
                AND r.entityId = t.id
                AND r.status IN ('open', 'claimed')
            ) as queueIssues,
            (
              (CASE WHEN t.albumId IS NULL THEN 1 ELSE 0 END) +
              (CASE WHEN t.genre IS NULL OR trim(t.genre) = '' THEN 1 ELSE 0 END) +
              (CASE WHEN t.year IS NULL THEN 1 ELSE 0 END) +
              (CASE WHEN t.bpm IS NULL THEN 1 ELSE 0 END) +
              (
                SELECT COUNT(*)
                FROM ReviewQueueItem r
                WHERE r.entityType = 'track'
                  AND r.entityId = t.id
                  AND r.status IN ('open', 'claimed')
              )
            ) as issueCount
          FROM Track t
          JOIN Artist a ON a.id = t.artistId
        )
        WHERE issueCount > 0
        ORDER BY issueCount DESC, title ASC
        LIMIT 10
      `),
  ]);

  const fields = fieldRows[0];
  const withAlbum = asNumber(fields?.withAlbum);
  const withGenre = asNumber(fields?.withGenre);
  const withYear = asNumber(fields?.withYear);
  const withBpm = asNumber(fields?.withBpm);
  const filledFields = totalTracks + withAlbum + withGenre + withYear + withBpm;

  return {
    totalTracks,
    tracksMissingMetadata,
    completenessPercent: completenessPercent(totalTracks, filledFields),
    pendingQueueItems,
    openDuplicates: exact + fuzzy,
    openDuplicatesExact: exact,
    openDuplicatesFuzzy: fuzzy,
    fieldBreakdown: [
      { field: "Artist", percent: fieldPercent(totalTracks, totalTracks) },
      { field: "Album", percent: fieldPercent(withAlbum, totalTracks) },
      { field: "Genre", percent: fieldPercent(withGenre, totalTracks) },
      { field: "Year", percent: fieldPercent(withYear, totalTracks) },
      { field: "BPM", percent: fieldPercent(withBpm, totalTracks) },
    ],
    problemTracks: problemRows.map((row) => {
      const queueIssues = asNumber(row.queueIssues);
      const issues = describeTrackIssues({
        albumId: row.albumId,
        genre: row.genre,
        year: row.year,
        bpm: row.bpm,
        queueIssues,
      });
      return {
        id: row.id,
        title: row.title,
        artistName: row.artistName,
        issueCount: asNumber(row.issueCount),
        issues,
      };
    }),
    generatedAt: now.toISOString(),
  };
}

export function getDashboardMetrics({ forceFresh = false }: { forceFresh?: boolean } = {}) {
  return cachified({
    key: DASHBOARD_METRICS_CACHE_KEY,
    cache,
    ttl: DASHBOARD_METRICS_TTL_MS,
    forceFresh,
    getFreshValue: () => computeDashboardMetrics(),
  });
}

type EditGroup = { editedBy: string; _count: { _all: number } };

async function countEditsByCurator(since: Date | null): Promise<Map<string, number>> {
  const where = since ? { editedAt: { gte: since } } : {};
  const [tracks, artists, albums] = await Promise.all([
    prisma.trackEdit.groupBy({ by: ["editedBy"], where, _count: { _all: true } }),
    prisma.artistEdit.groupBy({ by: ["editedBy"], where, _count: { _all: true } }),
    prisma.albumEdit.groupBy({ by: ["editedBy"], where, _count: { _all: true } }),
  ]);
  const totals = new Map<string, number>();
  for (const row of [...tracks, ...artists, ...albums] as EditGroup[]) {
    totals.set(row.editedBy, (totals.get(row.editedBy) ?? 0) + row._count._all);
  }
  return totals;
}

export async function getLeaderboard({
  period,
  limit = 10,
  now = new Date(),
}: {
  period: LeaderboardPeriod;
  limit?: number;
  now?: Date;
}): Promise<LeaderboardResult> {
  await awardCuratorBadges();
  const since = periodStart(period, now);
  const totals = await countEditsByCurator(since);
  const ids = [...totals.keys()];
  const users = ids.length
    ? await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, username: true, name: true },
      })
    : [];
  const byId = new Map(users.map((user) => [user.id, user]));
  const badgeMap = await badgesForCurators(ids);
  const ranked = assignRanks(
    [...totals.entries()]
      .map(([id, editCount]) => ({
        editCount,
        curator: byId.get(id) ?? { id, username: "unknown", name: null },
        badges: badgeMap.get(id) ?? [],
      }))
      .sort((a, b) => {
        if (b.editCount !== a.editCount) return b.editCount - a.editCount;
        return curatorLabel(a.curator).localeCompare(curatorLabel(b.curator));
      }),
  );

  return {
    period,
    entries: ranked.slice(0, limit),
  };
}

type EditRow = {
  id: string;
  createdAt: Date;
  comment: string | null;
  entityType: ActivityEntityType;
  entityId: string;
  entityName: string;
  curator: CuratorRef;
};

function editWhere(filters: { curatorId?: string; from?: Date; to?: Date }) {
  const editedAt =
    filters.from || filters.to
      ? {
          ...(filters.from ? { gte: filters.from } : {}),
          ...(filters.to ? { lte: filters.to } : {}),
        }
      : undefined;
  return {
    ...(filters.curatorId ? { editedBy: filters.curatorId } : {}),
    ...(editedAt ? { editedAt } : {}),
  };
}

async function loadEditRows(
  filters: { curatorId?: string; from?: Date; to?: Date; entityType?: ActivityEntityType },
  take: number,
): Promise<EditRow[]> {
  const where = editWhere(filters);
  const userSelect = { select: { id: true, username: true, name: true } } as const;
  const rows: EditRow[] = [];

  if (!filters.entityType || filters.entityType === "track") {
    const tracks = await prisma.trackEdit.findMany({
      where,
      orderBy: { editedAt: "desc" },
      take,
      include: {
        user: userSelect,
        track: { select: { id: true, title: true, artist: { select: { name: true } } } },
      },
    });
    for (const row of tracks) {
      rows.push({
        id: row.id,
        createdAt: row.editedAt,
        comment: row.comment,
        entityType: "track",
        entityId: row.trackId,
        entityName: `${row.track.title} — ${row.track.artist.name}`,
        curator: row.user,
      });
    }
  }

  if (!filters.entityType || filters.entityType === "artist") {
    const artists = await prisma.artistEdit.findMany({
      where,
      orderBy: { editedAt: "desc" },
      take,
      include: { user: userSelect, artist: { select: { id: true, name: true } } },
    });
    for (const row of artists) {
      rows.push({
        id: row.id,
        createdAt: row.editedAt,
        comment: row.comment,
        entityType: "artist",
        entityId: row.artistId,
        entityName: row.artist.name,
        curator: row.user,
      });
    }
  }

  if (!filters.entityType || filters.entityType === "album") {
    const albums = await prisma.albumEdit.findMany({
      where,
      orderBy: { editedAt: "desc" },
      take,
      include: {
        user: userSelect,
        album: { select: { id: true, name: true, artist: { select: { name: true } } } },
      },
    });
    for (const row of albums) {
      rows.push({
        id: row.id,
        createdAt: row.editedAt,
        comment: row.comment,
        entityType: "album",
        entityId: row.albumId,
        entityName: `${row.album.name} — ${row.album.artist.name}`,
        curator: row.user,
      });
    }
  }

  return rows;
}

function toActivityItem(row: EditRow, now: Date, badges: ActivityItem["badges"]): ActivityItem {
  const action = activityAction(row.comment);
  const summary = activitySummary(row.curator, action, row.entityName);
  return {
    id: `${row.entityType}:${row.id}`,
    action,
    entityType: row.entityType,
    entityId: row.entityId,
    entityName: row.entityName,
    summary,
    message: formatActivityLine(summary, row.createdAt, now),
    matter: activityMatter(row.comment),
    createdAt: row.createdAt.toISOString(),
    curator: row.curator,
    badges,
  };
}

async function listCurators(): Promise<CuratorRef[]> {
  return prisma.user.findMany({
    where: {
      OR: [
        { roles: { some: { name: { in: ["curator", "admin"] } } } },
        { trackEdits: { some: {} } },
        { artistEdits: { some: {} } },
        { albumEdits: { some: {} } },
      ],
    },
    select: { id: true, username: true, name: true },
    orderBy: { username: "asc" },
    take: 200,
  });
}

export async function getActivity({
  page = 1,
  pageSize = ACTIVITY_PAGE_SIZE,
  curatorId,
  entityType,
  from,
  to,
  now = new Date(),
}: {
  page?: number;
  pageSize?: number;
  curatorId?: string;
  entityType?: ActivityEntityType;
  from?: Date;
  to?: Date;
  now?: Date;
} = {}): Promise<ActivityResult> {
  await awardCuratorBadges();
  const safePage = Math.max(1, page);
  const safePageSize = Math.min(Math.max(1, pageSize), ACTIVITY_EXPORT_LIMIT);
  const filters = { curatorId, entityType, from, to };
  const where = editWhere(filters);
  const [trackCount, artistCount, albumCount, curators, rows] = await Promise.all([
    !entityType || entityType === "track" ? prisma.trackEdit.count({ where }) : Promise.resolve(0),
    !entityType || entityType === "artist"
      ? prisma.artistEdit.count({ where })
      : Promise.resolve(0),
    !entityType || entityType === "album" ? prisma.albumEdit.count({ where }) : Promise.resolve(0),
    listCurators(),
    loadEditRows(filters, safePage * safePageSize),
  ]);
  const total = trackCount + artistCount + albumCount;
  const pageRows = paginateNewest(
    [rows],
    safePage,
    safePageSize,
    (row) => row.createdAt.getTime(),
    (row) => row.id,
  );
  const badgeMap = await badgesForCurators(pageRows.map((row) => row.curator.id));

  return {
    items: pageRows.map((row) => toActivityItem(row, now, badgeMap.get(row.curator.id) ?? [])),
    page: safePage,
    pageSize: safePageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / safePageSize)),
    curators,
  };
}

export async function getDashboardCharts(now = new Date()): Promise<DashboardCharts> {
  const days = lastNDays(30, now);
  const dayExprCreated = DAY_EXPR("createdAt");
  const dayExprEdited = DAY_EXPR("editedAt");

  const [dailyRows, trackEdits, artistEdits, albumEdits, issueGroups] = await Promise.all([
    prisma.$queryRawUnsafe<{ day: string | null; created: unknown; filled: unknown }[]>(`
      SELECT
        ${dayExprCreated} as day,
        COUNT(*) as created,
        (
          COUNT(*) +
          SUM(CASE WHEN albumId IS NOT NULL THEN 1 ELSE 0 END) +
          SUM(CASE WHEN genre IS NOT NULL AND trim(genre) != '' THEN 1 ELSE 0 END) +
          SUM(CASE WHEN year IS NOT NULL THEN 1 ELSE 0 END) +
          SUM(CASE WHEN bpm IS NOT NULL THEN 1 ELSE 0 END)
        ) as filled
      FROM Track
      GROUP BY day
    `),
    prisma.$queryRawUnsafe<{ day: string | null; count: unknown }[]>(
      `SELECT ${dayExprEdited} as day, COUNT(*) as count FROM TrackEdit GROUP BY day`,
    ),
    prisma.$queryRawUnsafe<{ day: string | null; count: unknown }[]>(
      `SELECT ${dayExprEdited} as day, COUNT(*) as count FROM ArtistEdit GROUP BY day`,
    ),
    prisma.$queryRawUnsafe<{ day: string | null; count: unknown }[]>(
      `SELECT ${dayExprEdited} as day, COUNT(*) as count FROM AlbumEdit GROUP BY day`,
    ),
    prisma.reviewQueueItem.groupBy({
      by: ["issueType"],
      where: { status: { in: ["open", "claimed"] } },
      _count: { _all: true },
    }),
  ]);

  const editCounts = new Map<string, number>();
  for (const row of [...trackEdits, ...artistEdits, ...albumEdits]) {
    if (!row.day) continue;
    editCounts.set(row.day, (editCounts.get(row.day) ?? 0) + asNumber(row.count));
  }

  return {
    completenessOverTime: cumulativeCompleteness(
      dailyRows
        .filter((row) => row.day)
        .map((row) => ({
          day: row.day as string,
          created: asNumber(row.created),
          filled: asNumber(row.filled),
        })),
      days,
    ),
    editsPerDay: days.map((date) => ({ date, count: editCounts.get(date) ?? 0 })),
    issueTypes: issueGroups
      .map((group) => ({
        type: group.issueType,
        label: issueTypeLabel(group.issueType),
        count: group._count._all,
      }))
      .sort((a, b) => b.count - a.count),
  };
}
