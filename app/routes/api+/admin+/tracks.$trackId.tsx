import { data } from "react-router";
import { prisma } from "#app/utils/db.server.ts";
import { requireUserWithRole } from "#app/utils/permissions.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { deleteUnreferencedObjectKeys } from "#app/utils/audio-cleanup.server.ts";
import { type Route } from "./+types/tracks.$trackId.ts";

export async function action({ request, params }: Route.ActionArgs) {
  await requireUserWithRole(request, "admin");

  const { trackId } = params;

  if (request.method !== "DELETE") {
    throw data({ error: "Method not allowed" }, { status: 405 });
  }

  if (!trackId) {
    throw data({ error: "Track ID is required" }, { status: 400 });
  }

  // Get track with all related data
  const track = await prisma.track.findUnique({
    where: { id: trackId },
    include: {
      audioFiles: true,
      userTracks: true,
      playlists: true,
      servicePlaylistTracks: true,
    },
  });

  if (!track) {
    throw data({ error: "Track not found" }, { status: 404 });
  }

  const audioFiles = track.audioFiles;

  // Cascade-delete first, then re-count remaining TrackAudioFile rows.
  // persistTrackAudio can reuse the same objectKey for another track; a
  // pre-delete cleanup would wipe audio still needed for playback.
  await prisma.track.delete({
    where: { id: trackId },
  });

  await deleteUnreferencedObjectKeys(audioFiles.map((file) => file.objectKey));

  return data({
    success: true,
    trackId,
  });
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}
