import { existsSync } from "fs";
import { join, resolve, sep } from "path";
import { type LoaderFunctionArgs } from "react-router";
import { selectBestAudioFile } from "#app/domain/audio-format.ts";
import { requireUserId } from "#app/utils/auth.server";
import { serveLocalAudioFile } from "#app/utils/audio-serving.server.ts";
import { prisma } from "#app/utils/db.server";
import { getFileUrl, getStorageObjectStream } from "#app/utils/storage.server";
import {
  assertTrackAccessOrThrow,
  trackOwnershipAccessInclude,
} from "#app/utils/track-ownership.server";

export async function loader({ request, params, url }: LoaderFunctionArgs) {
  const userId = await requireUserId(request);
  const trackId = params.trackId;

  if (!trackId) {
    throw new Response("Track ID is required", { status: 400 });
  }

  // Get track with audio files
  const track = await prisma.track.findUnique({
    where: { id: trackId },
    include: {
      audioFiles: {
        select: {
          id: true,
          format: true,
          objectKey: true,
          mimeType: true,
        },
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

  // Check if file exists locally (for development)
  const fixturesDir = join(process.cwd(), "tests", "fixtures", "uploaded");
  const localFilePath = join(fixturesDir, audioFile.objectKey);
  const resolved = resolve(localFilePath);
  if (!resolved.startsWith(fixturesDir + sep)) {
    throw new Response("Invalid audio file path", { status: 500 });
  }
  const wantsStream = url.searchParams.has("stream");

  if (wantsStream) {
    if (existsSync(localFilePath)) {
      return serveLocalAudioFile(localFilePath, audioFile, request, "public, max-age=3600");
    }

    const { body, contentType, contentLength } = await getStorageObjectStream(audioFile.objectKey);

    return new Response(body, {
      headers: {
        "Content-Type": contentType,
        ...(contentLength ? { "Content-Length": contentLength.toString() } : {}),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  if (existsSync(localFilePath)) {
    const streamUrl = new URL(url.href);
    streamUrl.searchParams.set("stream", "1");
    return Response.json({ url: streamUrl.toString() });
  }

  // Generate signed URL for remote storage (Tigris/S3)
  // Use longer expiry for audio files (1 hour)
  const { url: signedUrl } = await getFileUrl(audioFile.objectKey, 3600);

  // Return presigned URL directly — client sets it on <audio src>
  // No redirect: per decision #22 in CONTEXT.md, the client talks to Tigris CDN directly.
  // CORS on the Tigris bucket enables Range-seeking.
  return Response.json({ url: signedUrl });
}
