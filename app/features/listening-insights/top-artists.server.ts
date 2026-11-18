import { USAGE_EVENT_TYPES } from "#app/features/usage-analytics/record-usage.server.ts";
import { chunkArray } from "#app/utils/chunk-array.ts";
import { prisma } from "#app/utils/db.server.ts";

export const PROFILE_TOP_LIST_CAP = 10;

export type TopArtist = {
  count: number;
  artist: { id: string; name: string };
};

/**
 * Top artists for a user by `play_completed` count (all-time).
 *
 * One bounded join (`UsageEvent → Track.artistId`, LIMIT in SQL) — dangling/null
 * trackIds drop out of the inner join. Tie-break: count desc → latest
 * `play_completed` desc → artist id asc.
 */
export async function getTopArtists({
  userId,
  limit = PROFILE_TOP_LIST_CAP,
}: {
  userId: string;
  limit?: number;
}): Promise<TopArtist[]> {
  const rows = await prisma.$queryRaw<Array<{ artistId: string; count: number | bigint }>>`
    SELECT t."artistId" AS artistId, COUNT(*) AS count
    FROM "UsageEvent" e
    JOIN "Track" t ON t."id" = e."trackId"
    WHERE e."userId" = ${userId} AND e."type" = ${USAGE_EVENT_TYPES.play_completed}
    GROUP BY t."artistId"
    ORDER BY COUNT(*) DESC, MAX(e."createdAt") DESC, t."artistId" ASC
    LIMIT ${limit}
  `;
  if (rows.length === 0) return [];

  const artistById = new Map<string, { id: string; name: string }>();
  for (const idChunk of chunkArray(rows.map((r) => r.artistId))) {
    const artists = await prisma.artist.findMany({
      where: { id: { in: idChunk } },
      select: { id: true, name: true },
    });
    for (const artist of artists) artistById.set(artist.id, artist);
  }

  const result: TopArtist[] = [];
  for (const row of rows) {
    const artist = artistById.get(row.artistId);
    if (!artist) continue;
    result.push({ count: Number(row.count), artist });
  }
  return result;
}
