import * as QRCode from "qrcode";
import { buildRoomJoinUrl } from "#app/features/party-room/codes.ts";
import { findOpenRoomByCode } from "#app/features/party-room/party-room.server.ts";
import { partyRoomErrorResponse } from "#app/features/party-room/request.server.ts";
import { getDomainUrl } from "#app/utils/misc.tsx";

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
    const joinUrl = buildRoomJoinUrl(getDomainUrl(request), room.code);
    const qrDataUrl = await QRCode.toDataURL(joinUrl);
    return Response.json({ code: room.code, joinUrl, qrDataUrl });
  } catch (error) {
    return partyRoomErrorResponse(error);
  }
}
