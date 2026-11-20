/**
 * Party Room karaoke video (host-only playback).
 * Same speaker grant as room audio (ADR-030); serves the track's video only
 * when its current karaoke version is ready.
 */

import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { type LoaderFunctionArgs } from "react-router";
import { partyRoomErrorResponse, resolveActor } from "#app/features/party-room/request.server.ts";
import { assertRoomSpeakerTrackAccess } from "#app/features/party-room/speaker-audio.server.ts";
import { serveLocalAudioFile, serveStorageAudioFile } from "#app/utils/audio-serving.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { isVideoObjectKey } from "#app/utils/storage.server.ts";

export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const trackId = params.trackId;
    if (!trackId) {
      throw new Response("Track ID is required", { status: 400 });
    }

    const actor = await resolveActor(request);
    await assertRoomSpeakerTrackAccess(actor, trackId);

    // `?v=<versionId>` pins the video to the version the overlay snapshotted
    // its lyrics from, so a mid-song repoint cannot mix lyrics and video.
    const pinnedVersionId = new URL(request.url).searchParams.get("v");
    const versionSelect = {
      status: true,
      videoFile: { select: { objectKey: true, mimeType: true } },
    } as const;
    let version;
    if (pinnedVersionId) {
      version = await prisma.trackKaraokeVersion.findFirst({
        where: { id: pinnedVersionId, trackId },
        select: versionSelect,
      });
    } else {
      const karaoke = await prisma.trackKaraoke.findUnique({
        where: { trackId },
        select: { currentVersion: { select: versionSelect } },
      });
      version = karaoke?.currentVersion;
    }
    const video = version?.status === "ready" ? version.videoFile : null;
    if (!video?.objectKey) {
      throw new Response("No karaoke video available for this track", {
        status: 404,
      });
    }

    if (!isVideoObjectKey(video.objectKey)) {
      throw new Response("No karaoke video available for this track", {
        status: 404,
      });
    }

    const media = { mimeType: video.mimeType || "video/mp4" };
    const cacheControl = "private, no-store";

    // Local-dev/MOCKS storage fallback (mirrors the library video route).
    const fixturesDir = join(process.cwd(), "tests", "fixtures", "uploaded");
    const localFilePath = join(fixturesDir, video.objectKey);
    if (!resolve(localFilePath).startsWith(fixturesDir + sep)) {
      throw new Response("Invalid video file path", { status: 500 });
    }
    if (existsSync(localFilePath)) {
      return serveLocalAudioFile(localFilePath, media, request, cacheControl);
    }

    return await serveStorageAudioFile(video.objectKey, media, request, cacheControl);
  } catch (error) {
    if (error instanceof Response) throw error;
    return partyRoomErrorResponse(error);
  }
}
