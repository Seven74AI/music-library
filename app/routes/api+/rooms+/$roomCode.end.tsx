import { endRoom, findOpenRoomByCode } from "#app/features/party-room/party-room.server.ts";
import { partyRoomErrorResponse, resolveActor } from "#app/features/party-room/request.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/$roomCode.end.ts";

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
    const ended = await endRoom({ roomId: room.id, actor });
    return Response.json({
      roomId: ended.id,
      status: ended.status,
      endedAt: ended.endedAt?.toISOString() ?? null,
      roomVersion: ended.roomVersion,
    });
  } catch (error) {
    return partyRoomErrorResponse(error);
  }
}
