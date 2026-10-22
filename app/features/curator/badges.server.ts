import { prisma } from "#app/utils/db.server.ts";
import {
  badgeLabel,
  earnedBadgeTypes,
  isBadgeType,
  summarizeBadges,
  type BadgeType,
  type CuratorBadgeSummary,
  type CuratorCounts,
  EMPTY_CURATOR_COUNTS,
} from "./badges.ts";

const AWARD_TTL_MS = 5 * 60 * 1000;
let awardedAt = 0;
let awardQueue: Promise<unknown> = Promise.resolve();

export function resetBadgeAwardCache() {
  awardedAt = 0;
}

/**
 * The dashboard awards badges from the leaderboard and the activity feed at
 * the same time. Run one award at a time so the second insert does not hit
 * the unique curator/badge constraint and fail the page.
 */
function enqueueAward<T>(task: () => Promise<T>): Promise<T> {
  const run = awardQueue.then(task, task);
  awardQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

function asNumber(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return 0;
}

type CountRow = { curatorId: string | null; count: unknown };

function addCount(
  totals: Map<string, CuratorCounts>,
  rows: CountRow[],
  metric: keyof CuratorCounts,
) {
  for (const row of rows) {
    if (!row.curatorId) continue;
    const current = totals.get(row.curatorId) ?? { ...EMPTY_CURATOR_COUNTS };
    current[metric] += asNumber(row.count);
    totals.set(row.curatorId, current);
  }
}

/**
 * Aggregate curator activity in SQL. Callers upsert the resulting badges;
 * this does not walk edit history in JavaScript.
 */
export async function loadCuratorCounts(): Promise<Map<string, CuratorCounts>> {
  const [edits, merges, queue, genres] = await Promise.all([
    prisma.$queryRawUnsafe<CountRow[]>(`
      SELECT editedBy AS curatorId, COUNT(*) AS count
      FROM (
        SELECT editedBy FROM TrackEdit
        UNION ALL
        SELECT editedBy FROM ArtistEdit
        UNION ALL
        SELECT editedBy FROM AlbumEdit
      )
      GROUP BY editedBy
    `),
    prisma.$queryRawUnsafe<CountRow[]>(`
      SELECT editedBy AS curatorId, COUNT(*) AS count
      FROM (
        SELECT editedBy FROM ArtistEdit
        WHERE comment LIKE 'MERGE:%' OR comment LIKE 'Merged into%'
        UNION ALL
        SELECT editedBy FROM AlbumEdit
        WHERE comment LIKE 'MERGE:%' OR comment LIKE 'Merged into%'
      )
      GROUP BY editedBy
    `),
    prisma.$queryRawUnsafe<Array<CountRow & { reports: unknown }>>(`
      SELECT
        resolvedBy AS curatorId,
        COUNT(*) AS count,
        SUM(CASE WHEN source = 'user_report' THEN 1 ELSE 0 END) AS reports
      FROM ReviewQueueItem
      WHERE status = 'resolved' AND resolvedBy IS NOT NULL
      GROUP BY resolvedBy
    `),
    prisma.$queryRawUnsafe<CountRow[]>(`
      WITH ordered AS (
        SELECT
          id,
          trackId,
          editedBy,
          IFNULL(genre, '') AS genre,
          IFNULL(genreIds, '') AS genreIds,
          ROW_NUMBER() OVER (PARTITION BY trackId ORDER BY editedAt ASC, id ASC) AS rn
        FROM TrackEdit
      )
      SELECT curatorId, COUNT(*) AS count
      FROM (
        SELECT
          cur.editedBy AS curatorId
        FROM ordered cur
        LEFT JOIN ordered nxt
          ON nxt.trackId = cur.trackId AND nxt.rn = cur.rn + 1
        LEFT JOIN Track t ON t.id = cur.trackId AND nxt.id IS NULL
        WHERE
          (
            nxt.id IS NOT NULL
            AND (cur.genre != IFNULL(nxt.genre, '') OR cur.genreIds != IFNULL(nxt.genreIds, ''))
          )
          OR (nxt.id IS NULL AND cur.genre != IFNULL(t.genre, ''))
      )
      GROUP BY curatorId
    `),
  ]);

  const totals = new Map<string, CuratorCounts>();
  addCount(totals, edits, "edits");
  addCount(totals, merges, "merges");
  addCount(totals, queue, "queueResolutions");
  for (const row of queue) {
    if (!row.curatorId) continue;
    const current = totals.get(row.curatorId) ?? { ...EMPTY_CURATOR_COUNTS };
    current.resolvedUserReports += asNumber(row.reports);
    totals.set(row.curatorId, current);
  }
  addCount(totals, genres, "genreEdits");
  return totals;
}

export function awardCuratorBadges(options?: {
  force?: boolean;
  now?: number;
}): Promise<{ awarded: number; skipped: boolean }> {
  // The dashboard loads metrics, the leaderboard, and activity together.
  // Each one awards badges, so parallel calls must not insert the same row.
  return enqueueAward(() => awardCuratorBadgesOnce(options));
}

async function awardCuratorBadgesOnce({
  force = false,
  now = Date.now(),
}: { force?: boolean; now?: number } = {}): Promise<{ awarded: number; skipped: boolean }> {
  if (!force && awardedAt > 0 && now - awardedAt < AWARD_TTL_MS) {
    return { awarded: 0, skipped: true };
  }

  const counts = await loadCuratorCounts();
  const earned: Array<{ curatorId: string; badgeType: BadgeType }> = [];
  for (const [curatorId, curatorCounts] of counts) {
    for (const badgeType of earnedBadgeTypes(curatorCounts)) {
      earned.push({ curatorId, badgeType });
    }
  }

  if (earned.length === 0) {
    awardedAt = now;
    return { awarded: 0, skipped: false };
  }

  const existing = await prisma.curatorBadge.findMany({
    where: { curatorId: { in: [...new Set(earned.map((row) => row.curatorId))] } },
    select: { curatorId: true, badgeType: true },
  });
  const have = new Set(existing.map((row) => `${row.curatorId}:${row.badgeType}`));
  const missing = earned.filter((row) => !have.has(`${row.curatorId}:${row.badgeType}`));
  let awarded = missing.length;
  if (missing.length > 0) {
    try {
      await prisma.curatorBadge.createMany({
        data: missing.map((row) => ({ curatorId: row.curatorId, badgeType: row.badgeType })),
      });
    } catch (error) {
      // A second process can still collide between the lookup and the write.
      // Keep the badges that won the insert instead of failing the dashboard.
      if (!isUniqueConstraintError(error)) throw error;
      awarded = 0;
    }
  }

  awardedAt = now;
  return { awarded, skipped: false };
}

export async function badgesForCurators(
  curatorIds: string[],
): Promise<Map<string, CuratorBadgeSummary[]>> {
  const result = new Map<string, CuratorBadgeSummary[]>();
  if (curatorIds.length === 0) return result;
  const rows = await prisma.curatorBadge.findMany({
    where: { curatorId: { in: curatorIds } },
    select: { curatorId: true, badgeType: true },
  });
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    if (!isBadgeType(row.badgeType)) continue;
    const list = grouped.get(row.curatorId) ?? [];
    list.push(row.badgeType);
    grouped.set(row.curatorId, list);
  }
  for (const [curatorId, types] of grouped) {
    result.set(curatorId, summarizeBadges(types));
  }
  return result;
}

export async function listCuratorBadges(userId?: string | null) {
  await awardCuratorBadges();
  const rows = await prisma.curatorBadge.findMany({
    where: userId ? { curatorId: userId } : undefined,
    orderBy: [{ curatorId: "asc" }, { earnedAt: "asc" }],
    select: {
      id: true,
      curatorId: true,
      badgeType: true,
      earnedAt: true,
      curator: { select: { id: true, username: true, name: true } },
    },
  });
  return {
    badges: rows.map((row) => ({
      id: row.id,
      curatorId: row.curatorId,
      badgeType: row.badgeType,
      label: badgeLabel(row.badgeType),
      earnedAt: row.earnedAt.toISOString(),
      curator: row.curator,
    })),
  };
}
