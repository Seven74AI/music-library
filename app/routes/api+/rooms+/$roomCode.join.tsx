import { parseRoomCodeInput } from "#app/features/party-room/codes.ts";
import { serializeGuestTokenCookie } from "#app/features/party-room/guest-token.server.ts";
import { joinRoom } from "#app/features/party-room/party-room.server.ts";
import {
  partyRoomErrorResponse,
  readJsonBody,
  resolveOptionalUserId,
} from "#app/features/party-room/request.server.ts";
import { readGuestToken } from "#app/features/party-room/guest-token.server.ts";
import { combineHeaders } from "#app/utils/misc.tsx";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/$roomCode.join.ts";

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
    const fromParam = params.roomCode?.toUpperCase() ?? "";
    const body = await readJsonBody(request);
    const rawCode = typeof body.code === "string" && body.code.trim() ? body.code : fromParam;
    const code = parseRoomCodeInput(rawCode) ?? fromParam;
    if (!code) {
      return Response.json({ error: "Room code required", code: "invalid_code" }, { status: 400 });
    }

    const userId = await resolveOptionalUserId(request);
    const displayName = typeof body.displayName === "string" ? body.displayName : undefined;

    if (userId) {
      const result = await joinRoom({
        code,
        actor: { type: "user", userId, displayName },
      });
      return Response.json({
        roomId: result.roomId,
        code: result.code,
        participant: result.participant,
      });
    }

    if (!displayName) {
      return Response.json(
        { error: "displayName is required for guests", code: "invalid_display_name" },
        { status: 400 },
      );
    }

    const existingToken = await readGuestToken(request);
    const result = await joinRoom({
      code,
      actor: { type: "guest", displayName, guestToken: existingToken },
    });

    const headers = result.guestToken
      ? combineHeaders({
          "Set-Cookie": await serializeGuestTokenCookie(result.guestToken),
        })
      : undefined;

    return Response.json(
      {
        roomId: result.roomId,
        code: result.code,
        participant: result.participant,
      },
      { headers },
    );
  } catch (error) {
    return partyRoomErrorResponse(error);
  }
}
