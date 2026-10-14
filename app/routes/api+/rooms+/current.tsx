import { ROOM_STATUS } from "#app/features/party-room/constants.ts";
import { getRoomSnapshot } from "#app/features/party-room/party-room.server.ts";
import {
  partyRoomErrorResponse,
  resolveOptionalUserId,
} from "#app/features/party-room/request.server.ts";
import { prisma } from "#app/utils/db.server.ts";

/**
 * Open room where the signed-in user still has a seat.
 * 204 when they are signed out or have no open seat (leftAt null, room open).
 * A login redirect would look like a room error to the always-on client poll.
 */
export async function loader({ request }: { request: Request }) {
  try {
    const userId = await resolveOptionalUserId(request);
    if (!userId) {
      return new Response(null, { status: 204 });
    }

    const seat = await prisma.roomParticipant.findFirst({
      where: {
        userId,
        leftAt: null,
        room: { status: ROOM_STATUS.open },
      },
      orderBy: { createdAt: "desc" },
      select: { roomId: true },
    });
    if (!seat) {
      return new Response(null, { status: 204 });
    }

    const snapshot = await getRoomSnapshot(seat.roomId, { type: "user", userId });
    if (!snapshot || snapshot.status !== ROOM_STATUS.open) {
      return new Response(null, { status: 204 });
    }

    return Response.json(snapshot);
  } catch (error) {
    return partyRoomErrorResponse(error);
  }
}
