import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { type Route } from "./+types/$id.ts";

/**
 * GET /api/artists/:id
 * Resolve an artist id to the name shown in artist autocomplete.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireUserId(request);
  const id = params.id;
  if (!id) {
    return Response.json({ artist: null }, { status: 400 });
  }

  const artist = await prisma.artist.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      _count: {
        select: {
          tracks: true,
        },
      },
    },
  });

  if (!artist) {
    return Response.json({ artist: null }, { status: 404 });
  }

  return Response.json({
    artist: {
      id: artist.id,
      name: artist.name,
      trackCount: artist._count.tracks,
    },
  });
}
