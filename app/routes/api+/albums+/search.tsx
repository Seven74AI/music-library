import { z } from "zod";
import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { type Route } from "./+types/search.ts";

const SearchQuerySchema = z.string().min(1).max(100);

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

  // Strip LIKE wildcards so a user-supplied '%' or '_' is treated verbatim
  // instead of as a SQLite LIKE wildcard (q=% would otherwise match everything).
  const cleanQuery = searchQuery.replace(/[%_]/g, "");
  if (!cleanQuery) {
    return Response.json({ albums: [] });
  }

  const albums = await prisma.album.findMany({
    where: {
      mergedIntoId: null,
      OR: [{ name: { contains: cleanQuery } }, { artist: { name: { contains: cleanQuery } } }],
    },
    select: {
      id: true,
      name: true,
      year: true,
      artist: {
        select: {
          name: true,
        },
      },
      _count: {
        select: {
          tracks: true,
        },
      },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 20,
  });

  return Response.json({
    albums: albums.map((album) => ({
      id: album.id,
      name: album.name,
      artistName: album.artist.name,
      year: album.year,
      trackCount: album._count.tracks,
    })),
  });
}
