import {
  findOpenRoomByCode,
  setDefaultJoinRole,
} from "#app/features/party-room/party-room.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import {
  partyRoomErrorResponse,
  readJsonBody,
  resolveActor,
} from "#app/features/party-room/request.server.ts";
import { type Route } from "./+types/$roomCode.settings.ts";

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
  if (request.method !== "POST" && request.method !== "PATCH") {
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
    if (typeof body.defaultJoinRole !== "string") {
      return Response.json(
        { error: "defaultJoinRole is required", code: "invalid_role" },
        { status: 400 },
      );
    }
    const snapshot = await setDefaultJoinRole({
      roomId: room.id,
      actor,
      defaultJoinRole: body.defaultJoinRole,
    });
    return Response.json(snapshot);
  } catch (error) {
    return partyRoomErrorResponse(error);
  }
}
