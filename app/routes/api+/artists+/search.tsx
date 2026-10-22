import { z } from "zod";
import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { type Route } from "./+types/search.ts";

const SearchQuerySchema = z.string().min(1).max(100);

export async function loader({ request }: Route.LoaderArgs) {
  await requireUserId(request);
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";

  const result = SearchQuerySchema.safeParse(query);
  if (!result.success) {
    return Response.json({ artists: [] });
  }

  const searchQuery = result.data.toLowerCase();

  // Search artists by name (case-insensitive)
  const artists = await prisma.artist.findMany({
    where: {
      mergedIntoId: null,
      normalizedName: {
        contains: searchQuery,
      },
    },
    select: {
      id: true,
      name: true,
      _count: {
        select: {
          tracks: true,
        },
      },
    },
    orderBy: {
      name: "asc",
    },
    take: 20,
  });

  return Response.json({
    artists: artists.map((artist) => ({
      id: artist.id,
      name: artist.name,
      trackCount: artist._count.tracks,
    })),
  });
}
