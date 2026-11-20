/**
 * Party Room karaoke lyrics (host-only playback).
 * Same speaker grant as room audio/video (ADR-030); returns the parsed
 * word-timed `lines` of the track's current karaoke version when it is ready.
 */

import { type LoaderFunctionArgs } from "react-router";
import { parseKaraokeLines } from "#app/features/track-video/karaoke-lines.ts";
import { partyRoomErrorResponse, resolveActor } from "#app/features/party-room/request.server.ts";
import { assertRoomSpeakerTrackAccess } from "#app/features/party-room/speaker-audio.server.ts";
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
        currentVersion: { select: { id: true, status: true, lines: true } },
      },
    });
    const version = karaoke?.currentVersion;
    const lines = version?.status === "ready" ? parseKaraokeLines(version.lines) : null;
    if (!version || !lines) {
      throw new Response("No karaoke lyrics available for this track", {
        status: 404,
      });
    }

    return Response.json(
      { versionId: version.id, lines },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof Response) throw error;
    return partyRoomErrorResponse(error);
  }
}
