import { ROOM_PLAY_EVENT_TYPES } from "#app/features/party-room/constants.ts";
import { findOpenRoomByCode } from "#app/features/party-room/party-room.server.ts";
import { recordRoomPlayEvent } from "#app/features/party-room/queue.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import {
  partyRoomErrorResponse,
  readJsonBody,
  resolveActor,
} from "#app/features/party-room/request.server.ts";
import { type Route } from "./+types/$roomCode.play-events.ts";

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
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const code = params.roomCode?.toUpperCase();
    if (!code) {
      return Response.json({ error: "Room code required" }, { status: 400 });
    }
    const room = await findOpenRoomByCode(code);
    const actor = await resolveActor(request);
    const body = await readJsonBody(request);

    const type = body.type;
    if (type !== ROOM_PLAY_EVENT_TYPES.started && type !== ROOM_PLAY_EVENT_TYPES.completed) {
      return Response.json({ error: "Invalid play event type" }, { status: 400 });
    }
    if (typeof body.trackId !== "string") {
      return Response.json({ error: "trackId required" }, { status: 400 });
    }

    const event = await recordRoomPlayEvent({
      roomId: room.id,
      actor,
      type,
      trackId: body.trackId,
      playId: typeof body.playId === "string" ? body.playId : undefined,
      addedByParticipantId:
        typeof body.addedByParticipantId === "string" ? body.addedByParticipantId : undefined,
    });

    return Response.json({
      id: event.id,
      type: event.type,
      trackId: event.trackId,
      createdAt: event.createdAt.toISOString(),
    });
  } catch (error) {
    return partyRoomErrorResponse(error);
  }
}
