/**
 * Stream audio for a short-lived Audition grant.
 * Separate from `/resources/audio/:trackId` — never opens that route to anonymous users.
 */

import { readFileSync, existsSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { type LoaderFunctionArgs } from "react-router";
import { selectBestAudioFile } from "#app/domain/audio-format.ts";
import { getAuditionGrant } from "#app/features/party-room/audition.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { getStorageObjectStream } from "#app/utils/storage.server.ts";

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
    if (rangeMatch && rangeMatch[1]) {
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
            "Cache-Control": "private, max-age=60",
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
      "Cache-Control": "private, max-age=60",
    },
  });
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const grantId = params.grantId;
  if (!grantId) {
    throw new Response("Grant ID required", { status: 400 });
  }

  const grant = getAuditionGrant(grantId);
  if (!grant) {
    throw new Response("Audition grant expired or invalid", { status: 401 });
  }

  const track = await prisma.track.findUnique({
    where: { id: grant.trackId },
    include: {
      audioFiles: {
        select: { id: true, format: true, objectKey: true, mimeType: true },
      },
    },
  });

  if (!track) {
    throw new Response("Track not found", { status: 404 });
  }

  const audioFile = selectBestAudioFile(track.audioFiles);
  if (!audioFile?.objectKey) {
    throw new Response("No audio file available", { status: 404 });
  }

  const fixturesDir = join(process.cwd(), "tests", "fixtures", "uploaded");
  const localFilePath = join(fixturesDir, audioFile.objectKey);
  const resolved = resolve(localFilePath);
  if (!resolved.startsWith(fixturesDir + sep)) {
    throw new Response("Invalid audio file path", { status: 500 });
  }

  if (existsSync(localFilePath)) {
    return serveLocalAudioFile(localFilePath, audioFile, request);
  }

  const { body, contentType, contentLength } = await getStorageObjectStream(audioFile.objectKey);
  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      ...(contentLength ? { "Content-Length": contentLength.toString() } : {}),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=60",
    },
  });
}
