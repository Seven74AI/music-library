import { z } from "zod";
import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { escapeLikeLiterals } from "#app/utils/fts5-query.server.ts";
import { type Route } from "./+types/search.ts";

const SearchQuerySchema = z.string().min(1).max(100);

type AlbumRow = {
  id: string;
  name: string;
  year: number | null;
  artistName: string;
  trackCount: number | bigint;
};

/**
 * GET /api/albums/search?q=
 * Case-insensitive album lookup for the track editor and bulk edit.
 * Merged albums are omitted so curators assign the surviving record.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireUserId(request);
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();

  const result = SearchQuerySchema.safeParse(query);
  if (!result.success) {
    return Response.json({ albums: [] });
  }

  const searchQuery = result.data;

  // Escape LIKE wildcards so a user-supplied '%', '_' or '\' is matched
  // literally rather than acting as a wildcard (searching '%' would otherwise
  // match every album). Pair with `ESCAPE '\'`.
  const like = `%${escapeLikeLiterals(searchQuery)}%`;

  const albums = await prisma.$queryRaw<AlbumRow[]>`
    SELECT a.id, a.name, a.year, ar.name AS "artistName",
      (SELECT COUNT(*) FROM "Track" t WHERE t."albumId" = a.id) AS "trackCount"
    FROM "Album" a
    JOIN "Artist" ar ON a."artistId" = ar.id
    WHERE a."mergedIntoId" IS NULL
      AND (a.name LIKE ${like} ESCAPE '\\' OR ar.name LIKE ${like} ESCAPE '\\')
    ORDER BY a.name ASC, a.id ASC
    LIMIT 20
  `;

  return Response.json({
    albums: albums.map((album) => ({
      id: album.id,
      name: album.name,
      year: album.year,
      artistName: album.artistName,
      trackCount: Number(album.trackCount),
    })),
  });
}
