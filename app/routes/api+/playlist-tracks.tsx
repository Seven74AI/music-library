import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import {
  parsePlaylistTracksQuery,
  playlistTracksPagination,
} from "#app/utils/playlist-tracks-pagination.server.ts";

export async function loader({ request, url }: { request: Request; url: URL }) {
  try {
    const userId = await requireUserId(request);

    const query = parsePlaylistTracksQuery(url);
    if (query.kind === "error") return query.response;

    const fields = url.searchParams.get("fields") || "full"; // 'minimal' or 'full'
    const isMinimal = fields === "minimal";

    const playlistTracksRaw = await prisma.userPlaylistTrack.findMany({
      where: {
        playlistId: query.playlistId,
        playlist: { ownerId: userId }, // Ensure user owns the playlist
      },
      include: {
        track: isMinimal
          ? {
              select: {
                id: true,
                title: true,
                artist: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            }
          : {
              include: {
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
                service: true,
                audioFiles: true,
              },
            },
      },
      orderBy: { position: "asc" },
      take: query.limit,
      ...(query.cursor && {
        skip: 1, // Skip the cursor item
        cursor: { id: query.cursor },
      }),
    });

    return Response.json({
      tracks: playlistTracksRaw.map((pt) => pt.track),
      pagination: playlistTracksPagination(playlistTracksRaw, query.limit),
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("Error fetching playlist tracks:", error);
    return Response.json({ error: "Failed to fetch tracks" }, { status: 500 });
  }
}
