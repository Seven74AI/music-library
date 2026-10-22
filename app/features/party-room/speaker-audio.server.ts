import { prisma } from "#app/utils/db.server.ts";
import { hashGuestToken } from "./guest-token.server.ts";
import { PartyRoomError, type ParticipantActor } from "./party-room.server.ts";
import { ROOM_STATUS } from "./constants.ts";

/**
 * ADR-030 speaker grant: current Host may stream a track that is on their open
 * room queue (bypasses personal library access).
 */
export async function assertRoomSpeakerTrackAccess(
  actor: ParticipantActor,
  trackId: string,
): Promise<{ roomId: string; participantId: string }> {
  if (actor.type === "system") {
    throw new PartyRoomError("forbidden", "System actor cannot stream speaker audio", 403);
  }

  const participantWhere =
    actor.type === "user"
      ? { userId: actor.userId, leftAt: null }
      : { guestTokenHash: hashGuestToken(actor.guestToken), leftAt: null };

  const hosted = await prisma.room.findFirst({
    where: {
      status: ROOM_STATUS.open,
      currentHostParticipant: participantWhere,
      queueItems: { some: { trackId } },
    },
    select: {
      id: true,
      currentHostParticipantId: true,
    },
  });

  if (!hosted?.currentHostParticipantId) {
    throw new PartyRoomError(
      "forbidden",
      "Speaker audio requires being the current Host of a room that has this track queued",
      403,
    );
  }

  return { roomId: hosted.id, participantId: hosted.currentHostParticipantId };
}
