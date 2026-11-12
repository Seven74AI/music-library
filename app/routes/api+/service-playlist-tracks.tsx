import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import {
  assertPlaylistTrackCursorInScope,
  parsePlaylistTracksQuery,
  playlistTracksPagination,
} from "#app/utils/playlist-tracks-pagination.server.ts";
import { isInvalidCursorError } from "#app/utils/search-validation.server.ts";

export async function loader({ request, url }: { request: Request; url: URL }) {
  try {
    const userId = await requireUserId(request);

    const query = parsePlaylistTracksQuery(url);
    if (query.kind === "error") return query.response;

    await assertPlaylistTrackCursorInScope({
      userId,
      playlistId: query.playlistId,
      cursor: query.cursor,
      kind: "service",
    });

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
      take: query.limit + 1,
      ...(query.cursor && {
        skip: 1, // Skip the cursor item
        cursor: { id: query.cursor },
      }),
    });

    const { pageRows, hasNext, nextCursor, limit } = playlistTracksPagination(
      playlistTracks,
      query.limit,
    );

    return Response.json({
      tracks: pageRows.map((pt) => pt.track),
      pagination: { hasNext, nextCursor, limit },
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    if (isInvalidCursorError(error)) {
      return Response.json({ error: "Invalid cursor" }, { status: 400 });
    }
    console.error("Error fetching service playlist tracks:", error);
    return Response.json({ error: "Failed to fetch tracks" }, { status: 500 });
  }
}
