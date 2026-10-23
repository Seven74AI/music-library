/**
 * Stream audio for a short-lived Audition grant.
 * Separate from `/resources/audio/:trackId` — never opens that route to anonymous users.
 */

import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { type LoaderFunctionArgs } from "react-router";
import { selectBestAudioFile } from "#app/domain/audio-format.ts";
import { getAuditionGrant } from "#app/features/party-room/audition.server.ts";
import { serveLocalAudioFile } from "#app/utils/audio-serving.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { getStorageObjectStream } from "#app/utils/storage.server.ts";

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
    return serveLocalAudioFile(localFilePath, audioFile, request, "private, max-age=60");
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
