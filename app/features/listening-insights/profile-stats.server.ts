import { USAGE_EVENT_TYPES } from "#app/features/usage-analytics/record-usage.server.ts";
import { chunkArray } from "#app/utils/chunk-array.ts";
import { prisma } from "#app/utils/db.server.ts";
import { PROFILE_TOP_LIST_CAP } from "./top-artists.server.ts";

export type ProfileStats = {
  plays: number;
  librarySize: number;
  listeningTimeSeconds: number;
};

export type TopTrack = {
  count: number;
  track: { id: string; title: string; artist: { id: string; name: string } };
};

/**
 * Profile totals over a single denominator: `play_completed` events joined to a
 * still-existing Track. Null durations contribute 0 seconds but the play counts.
 */
export async function getProfileStats({ userId }: { userId: string }): Promise<ProfileStats> {
  const [totals, librarySize] = await Promise.all([
    prisma.$queryRaw<Array<{ plays: number | bigint; seconds: number | bigint | null }>>`
      SELECT COUNT(*) AS plays, SUM(t."duration") AS seconds
      FROM "UsageEvent" e
      JOIN "Track" t ON t."id" = e."trackId"
      WHERE e."userId" = ${userId} AND e."type" = ${USAGE_EVENT_TYPES.play_completed}
    `,
    prisma.userTrack.count({ where: { userId, isActive: true, deletedAt: null } }),
  ]);
  const row = totals[0];
  return {
    plays: Number(row?.plays ?? 0),
    librarySize,
    listeningTimeSeconds: Number(row?.seconds ?? 0),
  };
}

/**
 * Top tracks by `play_completed` count (all-time), LIMIT pushed into SQL.
 * Tie-break: count desc → latest play desc → track id asc. Static rows only.
 */
export async function getTopTracks({
  userId,
  limit = PROFILE_TOP_LIST_CAP,
}: {
  userId: string;
  limit?: number;
}): Promise<TopTrack[]> {
  const rows = await prisma.$queryRaw<Array<{ trackId: string; count: number | bigint }>>`
    SELECT t."id" AS trackId, COUNT(*) AS count
    FROM "UsageEvent" e
    JOIN "Track" t ON t."id" = e."trackId"
    WHERE e."userId" = ${userId} AND e."type" = ${USAGE_EVENT_TYPES.play_completed}
    GROUP BY t."id"
    ORDER BY COUNT(*) DESC, MAX(e."createdAt") DESC, t."id" ASC
    LIMIT ${limit}
  `;
  if (rows.length === 0) return [];

  const trackById = new Map<string, TopTrack["track"]>();
  for (const idChunk of chunkArray(rows.map((r) => r.trackId))) {
    const tracks = await prisma.track.findMany({
      where: { id: { in: idChunk } },
      select: { id: true, title: true, artist: { select: { id: true, name: true } } },
    });
    for (const track of tracks) trackById.set(track.id, track);
  }

  const result: TopTrack[] = [];
  for (const row of rows) {
    const track = trackById.get(row.trackId);
    if (!track) continue;
    result.push({ count: Number(row.count), track });
  }
  return result;
}
