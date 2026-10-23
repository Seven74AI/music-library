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

    // Fetch tracks from service playlist (YouTube playlist)
    const playlistTracks = await prisma.servicePlaylistTrack.findMany({
      where: {
        playlistId: query.playlistId,
        playlist: { ownerId: userId }, // Ensure user owns the playlist
      },
      include: {
        track: {
          include: {
            service: {
              select: {
                displayName: true,
                logoUrl: true,
              },
            },
            audioFiles: {
              select: {
                id: true,
                format: true,
                objectKey: true,
              },
            },
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
      tracks: playlistTracks.map((pt) => pt.track),
      pagination: playlistTracksPagination(playlistTracks, query.limit),
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("Error fetching service playlist tracks:", error);
    return Response.json({ error: "Failed to fetch tracks" }, { status: 500 });
  }
}
