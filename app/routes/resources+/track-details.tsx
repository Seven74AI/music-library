import { data } from "react-router";
import { requireUserId } from "#app/utils/auth.server.ts";
import { userIsCuratorOrAdmin } from "#app/utils/curator.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { type Route } from "./+types/track-details.ts";

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const url = new URL(request.url);
  const trackId = url.searchParams.get("trackId");

  if (!trackId) {
    throw new Response("Missing trackId", { status: 400 });
  }

  const track = await prisma.track.findUnique({
    where: { id: trackId },
    select: {
      id: true,
      title: true,
      artist: {
        select: {
          id: true,
          name: true,
        },
      },
      albumRecord: {
        select: {
          id: true,
          name: true,
        },
      },
      duration: true,
      createdAt: true,
      releaseDate: true,
      originalDate: true,
      coverImage: {
        select: {
          objectKey: true,
        },
      },
      service: {
        select: {
          displayName: true,
        },
      },
      serviceUrl: true,
      // Additional metadata fields
      genre: true, // Keep for backward compatibility during migration
      genres: {
        select: {
          id: true,
          name: true,
        },
      },
      year: true,
      trackNumber: true,
      albumArtist: true,
      bpm: true,
      label: true,
      isrc: true,
      originalYear: true,
      totalTracks: true,
      totalDiscs: true,
      lyrics: true,
    },
  });

  if (!track) {
    throw new Response("Track not found", { status: 404 });
  }

  const isCurator = await userIsCuratorOrAdmin(userId);

  // Get notes count for curators
  let notesCount = 0;
  if (isCurator) {
    notesCount = await prisma.curatorNote.count({
      where: {
        entityType: "track",
        entityId: trackId,
      },
    });
  }

  return data({ track, isCurator, notesCount, currentUserId: userId });
}
