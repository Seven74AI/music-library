/**
 * Issue a participant-gated Audition grant (short-lived, one-at-a-time, ~20/min).
 */

import { z } from "zod";
import { issueAuditionGrant } from "#app/features/party-room/audition.server.ts";
import {
  resolveRoomParticipantByCode,
  toAuditionParticipant,
  touchParticipant,
} from "#app/features/party-room/participant-seat.server.ts";
import { partyRoomErrorResponse, readJsonBody } from "#app/features/party-room/request.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/$roomCode.audition.ts";

const BodySchema = z.object({
  trackId: z.string().min(1).max(128),
});

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

export async function action({
  request,
  params,
}: {
  request: Request;
  params: { roomCode?: string };
}) {
  try {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    const code = params.roomCode?.toUpperCase();
    if (!code) {
      return Response.json({ error: "Room code required" }, { status: 400 });
    }

    const participant = await resolveRoomParticipantByCode(request, code);
    const auditionParticipant = participant ? toAuditionParticipant(participant) : null;

    let trackId: string;
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const parsed = BodySchema.safeParse(await readJsonBody(request));
      if (!parsed.success) {
        return Response.json({ error: "Invalid body" }, { status: 400 });
      }
      trackId = parsed.data.trackId;
    } else {
      const formData = await request.formData();
      const parsed = BodySchema.safeParse({ trackId: formData.get("trackId") });
      if (!parsed.success) {
        return Response.json({ error: "Invalid body" }, { status: 400 });
      }
      trackId = parsed.data.trackId;
    }

    const track = await prisma.track.findUnique({
      where: { id: trackId },
      select: {
        id: true,
        title: true,
        duration: true,
        artist: { select: { name: true } },
        _count: { select: { audioFiles: true } },
      },
    });

    if (!track) {
      return Response.json({ error: "Track not found" }, { status: 404 });
    }

    const result = issueAuditionGrant({
      participant: auditionParticipant,
      trackId: track.id,
      trackHasAudio: track._count.audioFiles > 0,
    });

    if (!result.ok) {
      const status =
        result.reason === "not_seated"
          ? 401
          : result.reason === "room_ended"
            ? 410
            : result.reason === "no_audio"
              ? 404
              : result.reason === "rate_limited"
                ? 429
                : 403;
      const headers =
        result.reason === "rate_limited"
          ? { "Retry-After": String(result.retryAfterSeconds) }
          : undefined;
      return Response.json({ error: result.reason, code: result.reason }, { status, headers });
    }

    if (participant) await touchParticipant(participant.id);

    return Response.json({
      ok: true as const,
      grantId: result.grant.id,
      trackId: result.grant.trackId,
      expiresAt: result.grant.expiresAt,
      audioUrl: `/resources/audition/${result.grant.id}`,
      track: {
        id: track.id,
        title: track.title,
        artistName: track.artist.name,
        duration: track.duration,
      },
      revokedGrantId: result.revokedGrantId,
    });
  } catch (error) {
    return partyRoomErrorResponse(error);
  }
}
