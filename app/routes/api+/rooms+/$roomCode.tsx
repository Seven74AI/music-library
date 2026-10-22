import {
  findOpenRoomByCode,
  getRoomSnapshot,
  PartyRoomError,
} from "#app/features/party-room/party-room.server.ts";
import { resolveActorOptional } from "#app/features/party-room/participant-seat.server.ts";
import { partyRoomErrorResponse } from "#app/features/party-room/request.server.ts";

export async function loader({
  request,
  params,
}: {
  request: Request;
  params: { roomCode?: string };
}) {
  try {
    const code = params.roomCode?.toUpperCase();
    if (!code) {
      return Response.json({ error: "Room code required" }, { status: 400 });
    }
    const room = await findOpenRoomByCode(code);
    const actor = await resolveActorOptional(request);
    const snapshot = await getRoomSnapshot(room.id, actor);
    if (!snapshot) {
      throw new PartyRoomError("not_found", "Room not found", 404);
    }
    return Response.json(snapshot);
  } catch (error) {
    return partyRoomErrorResponse(error);
  }
}
