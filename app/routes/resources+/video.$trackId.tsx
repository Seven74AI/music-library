import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { type LoaderFunctionArgs } from "react-router";
import { serveLocalAudioFile, serveStorageAudioFile } from "#app/utils/audio-serving.server.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { isVideoObjectKey } from "#app/utils/storage.server.ts";

/**
 * Authenticated (NOT room-gated) video serving with HTTP Range support.
 * Room/speaker gating and ready-only enforcement land in slice 2.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireUserId(request);
  const trackId = params.trackId;
  if (!trackId) throw new Response("Track ID is required", { status: 400 });

  const videoFile = await prisma.trackVideoFile.findUnique({
    where: { trackId },
    select: { objectKey: true, mimeType: true },
  });
  if (!videoFile) throw new Response("No video available for this track", { status: 404 });
  if (!isVideoObjectKey(videoFile.objectKey)) {
    throw new Response("Invalid video object key", { status: 500 });
  }

  const media = { mimeType: videoFile.mimeType ?? "video/mp4" };
  const cacheControl = "private, no-store";

  // Local-dev storage fallback (mirrors the audio route).
  const fixturesDir = join(process.cwd(), "tests", "fixtures", "uploaded");
  const localFilePath = join(fixturesDir, videoFile.objectKey);
  if (!resolve(localFilePath).startsWith(fixturesDir + sep)) {
    throw new Response("Invalid video file path", { status: 500 });
  }
  if (existsSync(localFilePath)) {
    return serveLocalAudioFile(localFilePath, media, request, cacheControl);
  }

  return await serveStorageAudioFile(videoFile.objectKey, media, request, cacheControl);
}
