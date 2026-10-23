import { type LoaderFunctionArgs } from "react-router";
import { selectBestAudioFile } from "#app/domain/audio-format.ts";
import { requireUserId } from "#app/utils/auth.server";
import { prisma } from "#app/utils/db.server";
import { getFileUrl } from "#app/utils/storage.server";
import {
  assertTrackAccessOrThrow,
  trackOwnershipAccessInclude,
} from "#app/utils/track-ownership.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const userId = await requireUserId(request);
  const trackId = params.trackId;

  if (!trackId) {
    throw new Response("Track ID is required", { status: 400 });
  }

  // Get track with audio files
  const track = await prisma.track.findUnique({
    where: { id: trackId },
    include: {
      audioFiles: true,
      artist: {
        select: { name: true },
      },
      ...trackOwnershipAccessInclude(userId),
    },
  });

  if (!track) {
    throw new Response("Track not found", { status: 404 });
  }

  // Deny-by-default: the caller must own the track (library, a user-owned
  // active service playlist, or a user playlist).
  assertTrackAccessOrThrow(track);

  // Get best available audio file
  const audioFile = selectBestAudioFile(track.audioFiles);

  if (!audioFile) {
    throw new Response("No audio file available for this track", { status: 404 });
  }

  if (!audioFile.objectKey) {
    throw new Response("Audio file object key not found", { status: 500 });
  }

  const { url } = await getFileUrl(audioFile.objectKey, 3600);

  // Build a friendly download filename
  const format = audioFile.format || "mp3";
  const safeTitle =
    track.title
      .replace(/[^a-zA-Z0-9\u00C0-\u024F]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "") || "track";
  const fileName = `${safeTitle} - ${track.artist.name
    .replace(/[^a-zA-Z0-9\u00C0-\u024F]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")}.${format}`;

  return Response.json({
    url,
    fileName,
    mimeType: audioFile.mimeType || `audio/${format}`,
    format,
  });
}
