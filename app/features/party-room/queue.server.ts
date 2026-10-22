import { prisma } from "#app/utils/db.server.ts";
import {
  canAddTracks,
  canEditOthersUpcoming,
  canRemoveQueueItem,
  canTransport,
} from "./capabilities.ts";
import { MAX_QUEUE_TRACKS, ROOM_STATUS, type RoomRole } from "./constants.ts";
import { PartyRoomError, requireParticipant, type ParticipantActor } from "./party-room.server.ts";
import { addTrackRateLimit } from "./rate-limit.server.ts";
import { publishRoomEvent } from "./sse.server.ts";

async function loadOpenRoom(roomId: string) {
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) throw new PartyRoomError("not_found", "Room not found", 404);
  if (room.status !== ROOM_STATUS.open) {
    throw new PartyRoomError("room_ended", "Room has ended", 410);
  }
  return room;
}

async function emitSnapshot(roomId: string) {
  const { getRoomSnapshot } = await import("./party-room.server.ts");
  const snapshot = await getRoomSnapshot(roomId);
  if (snapshot) {
    publishRoomEvent(roomId, { type: "room_snapshot", ...snapshot });
  }
  return snapshot;
}

async function assertTrackHasAudio(trackId: string) {
  const audio = await prisma.trackAudioFile.findFirst({
    where: { trackId },
    select: { id: true },
  });
  if (!audio) {
    throw new PartyRoomError("track_no_audio", "Track has no audio file", 400);
  }
}

/**
 * Append rows with dense positions. Locks the room row first so concurrent
 * Host/DJ adds cannot both read the same max position and write duplicates.
 * `currentIndex` is both the pointer and a position value, so collisions
 * make skip/now-playing miss the added tracks.
 */
async function appendTracksToOpenRoomQueue({
  roomId,
  rows,
}: {
  roomId: string;
  rows: Array<{ trackId: string; addedByParticipantId: string }>;
}): Promise<{ addedCount: number; truncated: boolean }> {
  if (rows.length === 0) {
    return { addedCount: 0, truncated: false };
  }

  return prisma.$transaction(async (tx) => {
    const room = await tx.room.findUnique({ where: { id: roomId } });
    if (!room) throw new PartyRoomError("not_found", "Room not found", 404);
    if (room.status !== ROOM_STATUS.open) {
      throw new PartyRoomError("room_ended", "Room has ended", 410);
    }

    await tx.room.update({
      where: { id: roomId },
      data: { roomVersion: { increment: 1 } },
    });

    const count = await tx.roomQueueItem.count({ where: { roomId } });
    if (count >= MAX_QUEUE_TRACKS) {
      throw new PartyRoomError("queue_full", "Room queue is full", 409);
    }

    const toAdd = rows.slice(0, MAX_QUEUE_TRACKS - count);
    const maxPos =
      (
        await tx.roomQueueItem.aggregate({
          where: { roomId },
          _max: { position: true },
        })
      )._max.position ?? -1;

    await tx.roomQueueItem.createMany({
      data: toAdd.map((row, i) => ({
        roomId,
        trackId: row.trackId,
        position: maxPos + 1 + i,
        addedByParticipantId: row.addedByParticipantId,
      })),
    });

    return {
      addedCount: toAdd.length,
      truncated: toAdd.length < rows.length,
    };
  });
}

export async function addTrackToQueue({
  roomId,
  actor,
  trackId,
}: {
  roomId: string;
  actor: ParticipantActor;
  trackId: string;
}) {
  await loadOpenRoom(roomId);
  const participant = await requireParticipant(roomId, actor);
  if (!canAddTracks(participant.role as RoomRole)) {
    throw new PartyRoomError("forbidden", "Your role cannot add tracks", 403);
  }

  const budget = addTrackRateLimit.consume(participant.id);
  if (!budget.allowed) {
    throw new PartyRoomError("rate_limited", "Too many track adds", 429, budget.retryAfterSeconds);
  }

  await assertTrackHasAudio(trackId);

  await appendTracksToOpenRoomQueue({
    roomId,
    rows: [{ trackId, addedByParticipantId: participant.id }],
  });

  return emitSnapshot(roomId);
}

export async function addPlaylistToQueue({
  roomId,
  actor,
  playlistId,
}: {
  roomId: string;
  actor: ParticipantActor;
  playlistId: string;
}) {
  await loadOpenRoom(roomId);
  const participant = await requireParticipant(roomId, actor);
  if (participant.role !== "host") {
    throw new PartyRoomError("forbidden", "Only the Host can add a playlist", 403);
  }
  if (actor.type !== "user") {
    throw new PartyRoomError("forbidden", "Only a logged-in Host can add a playlist", 403);
  }

  const playlist = await prisma.userPlaylist.findFirst({
    where: { id: playlistId, ownerId: actor.userId },
    include: {
      tracks: {
        orderBy: { position: "asc" },
        include: {
          track: { include: { audioFiles: { select: { id: true }, take: 1 } } },
        },
      },
    },
  });
  if (!playlist) {
    throw new PartyRoomError("not_found", "Playlist not found", 404);
  }

  const withAudio = playlist.tracks.filter((t) => t.track.audioFiles.length > 0);
  const appended = await appendTracksToOpenRoomQueue({
    roomId,
    rows: withAudio.map((row) => ({
      trackId: row.trackId,
      addedByParticipantId: participant.id,
    })),
  });

  return {
    snapshot: await emitSnapshot(roomId),
    addedCount: appended.addedCount,
    skippedNoAudio: playlist.tracks.length - withAudio.length,
    truncated: appended.truncated,
  };
}

export async function removeQueueItem({
  roomId,
  actor,
  queueItemId,
}: {
  roomId: string;
  actor: ParticipantActor;
  queueItemId: string;
}) {
  const room = await loadOpenRoom(roomId);
  const participant = await requireParticipant(roomId, actor);
  const item = await prisma.roomQueueItem.findFirst({
    where: { id: queueItemId, roomId },
  });
  if (!item) throw new PartyRoomError("not_found", "Queue item not found", 404);

  const isUpcoming = item.position > room.currentIndex;
  if (
    !canRemoveQueueItem({
      role: participant.role as RoomRole,
      addedByParticipantId: item.addedByParticipantId,
      actorParticipantId: participant.id,
      isUpcoming,
    })
  ) {
    throw new PartyRoomError("forbidden", "Cannot remove this queue item", 403);
  }

  await prisma.$transaction(async (tx) => {
    await tx.roomQueueItem.delete({ where: { id: item.id } });
    // Compact positions after the removed item
    await tx.roomQueueItem.updateMany({
      where: { roomId, position: { gt: item.position } },
      data: { position: { decrement: 1 } },
    });
    // If we removed something at/before pointer, clamp currentIndex
    let currentIndex = room.currentIndex;
    if (item.position < room.currentIndex) {
      currentIndex = Math.max(0, room.currentIndex - 1);
    } else if (item.position === room.currentIndex) {
      // Removing current — pointer stays; next track slides into place
      const remaining = await tx.roomQueueItem.count({ where: { roomId } });
      if (currentIndex >= remaining) {
        currentIndex = Math.max(0, remaining - 1);
      }
    }
    await tx.room.update({
      where: { id: roomId },
      data: { currentIndex, roomVersion: { increment: 1 } },
    });
  });

  return emitSnapshot(roomId);
}

export async function reorderUpcoming({
  roomId,
  actor,
  orderedUpcomingIds,
}: {
  roomId: string;
  actor: ParticipantActor;
  orderedUpcomingIds: string[];
}) {
  const room = await loadOpenRoom(roomId);
  const participant = await requireParticipant(roomId, actor);
  if (!canEditOthersUpcoming(participant.role as RoomRole)) {
    throw new PartyRoomError("forbidden", "Your role cannot reorder the queue", 403);
  }

  const upcoming = await prisma.roomQueueItem.findMany({
    where: { roomId, position: { gt: room.currentIndex } },
    orderBy: { position: "asc" },
  });

  if (upcoming.length !== orderedUpcomingIds.length) {
    throw new PartyRoomError(
      "invalid_queue_op",
      "orderedUpcomingIds must include every upcoming item exactly once",
      400,
    );
  }
  const upcomingIds = new Set(upcoming.map((u) => u.id));
  for (const id of orderedUpcomingIds) {
    if (!upcomingIds.has(id)) {
      throw new PartyRoomError("invalid_queue_op", "Unknown upcoming queue item", 400);
    }
  }
  if (new Set(orderedUpcomingIds).size !== orderedUpcomingIds.length) {
    throw new PartyRoomError("invalid_queue_op", "Duplicate queue item ids", 400);
  }

  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < orderedUpcomingIds.length; i++) {
      await tx.roomQueueItem.update({
        where: { id: orderedUpcomingIds[i]! },
        data: { position: room.currentIndex + 1 + i },
      });
    }
    await tx.room.update({
      where: { id: roomId },
      data: { roomVersion: { increment: 1 } },
    });
  });

  return emitSnapshot(roomId);
}

export async function setTransport({
  roomId,
  actor,
  isPlaying,
}: {
  roomId: string;
  actor: ParticipantActor;
  isPlaying: boolean;
}) {
  await loadOpenRoom(roomId);
  const participant = await requireParticipant(roomId, actor);
  if (!canTransport(participant.role as RoomRole)) {
    throw new PartyRoomError("forbidden", "Only the Host can control transport", 403);
  }
  await prisma.room.update({
    where: { id: roomId },
    data: { isPlaying, roomVersion: { increment: 1 } },
  });
  return emitSnapshot(roomId);
}

export async function skipToIndex({
  roomId,
  actor,
  index,
}: {
  roomId: string;
  actor: ParticipantActor;
  index: number;
}) {
  await loadOpenRoom(roomId);
  const participant = await requireParticipant(roomId, actor);
  if (!canTransport(participant.role as RoomRole)) {
    throw new PartyRoomError("forbidden", "Only the Host can skip", 403);
  }

  const count = await prisma.roomQueueItem.count({ where: { roomId } });
  if (count === 0) {
    throw new PartyRoomError("invalid_queue_op", "Queue is empty", 400);
  }
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new PartyRoomError("invalid_queue_op", "Index out of range", 400);
  }
  // Pointer may only move forward into upcoming (or stay); history stays above.
  // Jumping to any index including past history is allowed for Host (jump-to).
  await prisma.room.update({
    where: { id: roomId },
    data: {
      currentIndex: index,
      isPlaying: true,
      roomVersion: { increment: 1 },
    },
  });
  return emitSnapshot(roomId);
}

export async function skipNext({ roomId, actor }: { roomId: string; actor: ParticipantActor }) {
  const room = await loadOpenRoom(roomId);
  const count = await prisma.roomQueueItem.count({ where: { roomId } });
  const next = room.currentIndex + 1;
  // End of queue (or empty): stop instead of clamping to the last row and
  // leaving isPlaying true. Host auto-skip on `ended` would otherwise stall
  // with a silent speaker while the room still reports "playing".
  if (count === 0 || next >= count) {
    return setTransport({ roomId, actor, isPlaying: false });
  }
  return skipToIndex({ roomId, actor, index: next });
}

export async function recordRoomPlayEvent({
  roomId,
  actor,
  type,
  trackId,
  playId,
  addedByParticipantId,
}: {
  roomId: string;
  actor: ParticipantActor;
  type: "room_play_started" | "room_play_completed";
  trackId: string;
  playId?: string;
  addedByParticipantId?: string;
}) {
  await loadOpenRoom(roomId);
  const participant = await requireParticipant(roomId, actor);
  if (!canTransport(participant.role as RoomRole)) {
    throw new PartyRoomError("forbidden", "Only the Host/speaker may record room play events", 403);
  }

  const event = await prisma.roomPlayEvent.create({
    data: {
      roomId,
      trackId,
      type,
      playId: playId ?? null,
      addedByParticipantId: addedByParticipantId ?? null,
    },
  });
  return event;
}
