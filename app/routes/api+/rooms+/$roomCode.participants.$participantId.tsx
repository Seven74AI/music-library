import {
  changeParticipantRole,
  findOpenRoomByCode,
  kickParticipant,
} from "#app/features/party-room/party-room.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import {
  partyRoomErrorResponse,
  readJsonBody,
  resolveActor,
} from "#app/features/party-room/request.server.ts";
import { type Route } from "./+types/$roomCode.participants.$participantId.ts";

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

export async function action({
  request,
  params,
}: {
  request: Request;
  params: { roomCode?: string; participantId?: string };
}) {
  try {
    const code = params.roomCode?.toUpperCase();
    const participantId = params.participantId;
    if (!code || !participantId) {
      return Response.json({ error: "Room code and participant id required" }, { status: 400 });
    }
    const room = await findOpenRoomByCode(code);
    const actor = await resolveActor(request);

    if (request.method === "DELETE") {
      const snapshot = await kickParticipant({
        roomId: room.id,
        actor,
        targetParticipantId: participantId,
      });
      return Response.json(snapshot);
    }

    if (request.method === "POST" || request.method === "PATCH") {
      const body = await readJsonBody(request);
      if (typeof body.role !== "string") {
        return Response.json({ error: "role is required", code: "invalid_role" }, { status: 400 });
      }
      const snapshot = await changeParticipantRole({
        roomId: room.id,
        actor,
        targetParticipantId: participantId,
        role: body.role,
      });
      return Response.json(snapshot);
    }

    return Response.json({ error: "Method not allowed" }, { status: 405 });
  } catch (error) {
    return partyRoomErrorResponse(error);
  }
}
