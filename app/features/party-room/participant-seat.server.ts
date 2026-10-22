/**
 * Resolve the caller's RoomParticipant seat using backend guest/user actors.
 */

import { prisma } from "#app/utils/db.server.ts";
import { type AuditionParticipant } from "./audition.server.ts";
import { isRoomRole } from "./capabilities.ts";
import { ROOM_STATUS, type DefaultJoinRole, type RoomRole, type RoomStatus } from "./constants.ts";
import { readGuestToken } from "./guest-token.server.ts";
import {
  findOpenRoomByCode,
  resolveParticipant,
  type ParticipantActor,
} from "./party-room.server.ts";
import { resolveOptionalUserId } from "./request.server.ts";

export type SeatedParticipant = {
  id: string;
  roomId: string;
  roomCode: string;
  displayName: string;
  role: RoomRole;
  roomStatus: RoomStatus;
  defaultJoinRole: DefaultJoinRole;
  userId: string | null;
};

export function toAuditionParticipant(p: SeatedParticipant): AuditionParticipant {
  return {
    id: p.id,
    roomId: p.roomId,
    role: p.role,
    roomStatus: p.roomStatus,
  };
}

export async function resolveActorOptional(request: Request): Promise<ParticipantActor | null> {
  const userId = await resolveOptionalUserId(request);
  if (userId) return { type: "user", userId };
  const guestToken = await readGuestToken(request);
  if (guestToken) return { type: "guest", guestToken };
  return null;
}

export async function resolveRoomParticipantByCode(
  request: Request,
  roomCode: string,
): Promise<SeatedParticipant | null> {
  try {
    const room = await findOpenRoomByCode(roomCode.toUpperCase());
    const actor = await resolveActorOptional(request);
    if (!actor || actor.type === "system") return null;

    const participant = await resolveParticipant(room.id, actor);
    if (!participant) return null;

    const role: RoomRole = isRoomRole(participant.role) ? participant.role : "listener";
    const defaultJoinRole: DefaultJoinRole = room.defaultJoinRole === "dj" ? "dj" : "listener";

    return {
      id: participant.id,
      roomId: room.id,
      roomCode: room.code,
      displayName: participant.displayName,
      role,
      roomStatus: room.status === ROOM_STATUS.ended ? ROOM_STATUS.ended : ROOM_STATUS.open,
      defaultJoinRole,
      userId: participant.userId,
    };
  } catch {
    return null;
  }
}

export async function touchParticipant(participantId: string): Promise<void> {
  await prisma.roomParticipant.update({
    where: { id: participantId },
    data: { lastSeenAt: new Date() },
  });
}
