import { requireUserId } from "#app/utils/auth.server.ts";
import { DEFAULT_JOIN_ROLE } from "#app/features/party-room/constants.ts";
import { createRoom, isDefaultJoinRole } from "#app/features/party-room/party-room.server.ts";
import { partyRoomErrorResponse, readJsonBody } from "#app/features/party-room/request.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/index.ts";

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const userId = await requireUserId(request);
    const body = await readJsonBody(request);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, username: true },
    });
    const displayName =
      typeof body.displayName === "string" && body.displayName.trim()
        ? body.displayName.trim()
        : user?.name?.trim() || user?.username || "Host";
    const defaultJoinRole =
      typeof body.defaultJoinRole === "string" && isDefaultJoinRole(body.defaultJoinRole)
        ? body.defaultJoinRole
        : DEFAULT_JOIN_ROLE.listener;

    const room = await createRoom({ userId, displayName, defaultJoinRole });
    return Response.json({
      roomId: room.id,
      code: room.code,
      status: room.status,
      defaultJoinRole: room.defaultJoinRole,
      roomVersion: room.roomVersion,
      currentHostParticipantId: room.currentHostParticipantId,
      participants: room.participants,
      queue: room.queueItems,
    });
  } catch (error) {
    return partyRoomErrorResponse(error);
  }
}
