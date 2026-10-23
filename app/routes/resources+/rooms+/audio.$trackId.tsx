/**
 * Party Room speaker audio grant (ADR-030).
 * Current Host may stream tracks that are on their open room queue.
 */

import { existsSync } from "fs";
import { join, resolve, sep } from "path";
import { type LoaderFunctionArgs } from "react-router";
import { selectBestAudioFile } from "#app/domain/audio-format.ts";
import { partyRoomErrorResponse, resolveActor } from "#app/features/party-room/request.server.ts";
import { assertRoomSpeakerTrackAccess } from "#app/features/party-room/speaker-audio.server.ts";
import { serveLocalAudioFile } from "#app/utils/audio-serving.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { getFileUrl, getStorageObjectStream } from "#app/utils/storage.server.ts";

export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const trackId = params.trackId;
    if (!trackId) {
      throw new Response("Track ID is required", { status: 400 });
    }

    const actor = await resolveActor(request);
    await assertRoomSpeakerTrackAccess(actor, trackId);

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
      },
    });
    if (!track) {
      throw new Response("Track not found", { status: 404 });
    }

    const audioFile = selectBestAudioFile(track.audioFiles);
    if (!audioFile?.objectKey) {
      throw new Response("No audio file available for this track", { status: 404 });
    }

    const fixturesDir = join(process.cwd(), "tests", "fixtures", "uploaded");
    const localFilePath = join(fixturesDir, audioFile.objectKey);
    const resolved = resolve(localFilePath);
    if (!resolved.startsWith(fixturesDir + sep)) {
      throw new Response("Invalid audio file path", { status: 500 });
    }

    // <audio src> needs bytes or a redirect — stream locally or redirect to signed URL.
    if (existsSync(localFilePath)) {
      return serveLocalAudioFile(localFilePath, audioFile, request, "private, max-age=3600");
    }

    try {
      const { body, contentType, contentLength } = await getStorageObjectStream(
        audioFile.objectKey,
      );
      return new Response(body, {
        headers: {
          "Content-Type": contentType,
          ...(contentLength ? { "Content-Length": contentLength.toString() } : {}),
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, max-age=3600",
        },
      });
    } catch {
      // Deliberate exception to decision #22 ("no redirect — direct presigned
      // URL"): streaming is the primary path; when getStorageObjectStream is
      // unavailable (e.g. storage not configured) we fall back to a presigned
      // URL so playback still works rather than returning an error.
      const { url: signedUrl } = await getFileUrl(audioFile.objectKey, 3600);
      return Response.redirect(signedUrl, 302);
    }
  } catch (error) {
    if (error instanceof Response) throw error;
    return partyRoomErrorResponse(error);
  }
}
