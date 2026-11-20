/**
 * Party Room karaoke video (host-only playback).
 * Same speaker grant as room audio (ADR-030); serves the track's video only
 * when its current karaoke version is ready.
 */

import { type LoaderFunctionArgs } from "react-router";
import { partyRoomErrorResponse, resolveActor } from "#app/features/party-room/request.server.ts";
import { assertRoomSpeakerTrackAccess } from "#app/features/party-room/speaker-audio.server.ts";
import { serveStorageAudioFile } from "#app/utils/audio-serving.server.ts";
import { prisma } from "#app/utils/db.server.ts";

export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const trackId = params.trackId;
    if (!trackId) {
      throw new Response("Track ID is required", { status: 400 });
    }

    const actor = await resolveActor(request);
    await assertRoomSpeakerTrackAccess(actor, trackId);

    const karaoke = await prisma.trackKaraoke.findUnique({
      where: { trackId },
      select: {
        currentVersion: {
          select: {
            status: true,
            videoFile: { select: { objectKey: true, mimeType: true } },
          },
        },
      },
    });
    const version = karaoke?.currentVersion;
    const video = version?.status === "ready" ? version.videoFile : null;
    if (!video?.objectKey) {
      throw new Response("No karaoke video available for this track", { status: 404 });
    }

    return await serveStorageAudioFile(
      video.objectKey,
      { mimeType: video.mimeType || "video/mp4" },
      request,
      "private, no-store",
    );
  } catch (error) {
    if (error instanceof Response) throw error;
    return partyRoomErrorResponse(error);
  }
}
