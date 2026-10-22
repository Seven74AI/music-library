/**
 * Party Room speaker audio grant (ADR-030).
 * Current Host may stream tracks that are on their open room queue.
 */

import { existsSync, readFileSync, openSync, readSync, closeSync, statSync } from "fs";
import { join, resolve, sep } from "path";
import { type LoaderFunctionArgs } from "react-router";
import { selectBestAudioFile } from "#app/domain/audio-format.ts";
import { partyRoomErrorResponse, resolveActor } from "#app/features/party-room/request.server.ts";
import { assertRoomSpeakerTrackAccess } from "#app/features/party-room/speaker-audio.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { getFileUrl, getStorageObjectStream } from "#app/utils/storage.server.ts";

function serveLocalAudioFile(
  localFilePath: string,
  audioFile: { mimeType: string | null },
  request: Request,
) {
  const mimeType = audioFile.mimeType || "audio/flac";
  const fileStats = statSync(localFilePath);
  const fileSize = fileStats.size;
  const rangeHeader = request.headers.get("Range");

  if (rangeHeader) {
    const rangeMatch = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (rangeMatch?.[1]) {
      const start = parseInt(rangeMatch[1], 10);
      const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : fileSize - 1;
      const chunkSize = end - start + 1;
      if (start >= 0 && start < fileSize && end < fileSize && start <= end) {
        const fileBuffer = Buffer.allocUnsafe(chunkSize);
        const fd = openSync(localFilePath, "r");
        readSync(fd, fileBuffer, 0, chunkSize, start);
        closeSync(fd);
        return new Response(fileBuffer, {
          status: 206,
          headers: {
            "Content-Type": mimeType,
            "Content-Length": chunkSize.toString(),
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Accept-Ranges": "bytes",
            "Cache-Control": "private, max-age=3600",
          },
        });
      }
    }
  }

  const fileBuffer = readFileSync(localFilePath);
  return new Response(fileBuffer, {
    headers: {
      "Content-Type": mimeType,
      "Content-Length": fileSize.toString(),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
    },
  });
}

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
      return serveLocalAudioFile(localFilePath, audioFile, request);
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
      const { url: signedUrl } = await getFileUrl(audioFile.objectKey, 3600);
      return Response.redirect(signedUrl, 302);
    }
  } catch (error) {
    if (error instanceof Response) throw error;
    return partyRoomErrorResponse(error);
  }
}
