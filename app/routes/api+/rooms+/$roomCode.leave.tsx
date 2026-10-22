import { destroyGuestTokenCookie } from "#app/features/party-room/guest-token.server.ts";
import { leaveRoom, findOpenRoomByCode } from "#app/features/party-room/party-room.server.ts";
import { partyRoomErrorResponse, resolveActor } from "#app/features/party-room/request.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/$roomCode.leave.ts";

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
    const result = await leaveRoom({ roomId: room.id, actor });
    const headers = new Headers({ "Content-Type": "application/json" });
    if (actor.type === "guest") {
      headers.append("Set-Cookie", await destroyGuestTokenCookie());
    }
    return Response.json(result, { headers });
  } catch (error) {
    return partyRoomErrorResponse(error);
  }
}
