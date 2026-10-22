import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { type Route } from "./+types/$id.ts";

/**
 * GET /api/albums/:id
 * Resolve an album id to the name shown in album autocomplete.
 * Merged albums are returned so a stored id can still be displayed.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireUserId(request);
  const id = params.id;
  if (!id) {
    return Response.json({ album: null }, { status: 400 });
  }

  const album = await prisma.album.findUnique({
    where: { id },
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
  });

  if (!album) {
    return Response.json({ album: null }, { status: 404 });
  }

  return Response.json({
    album: {
      id: album.id,
      name: album.name,
      artistName: album.artist.name,
      year: album.year,
      trackCount: album._count.tracks,
    },
  });
}
