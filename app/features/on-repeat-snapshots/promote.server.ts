import { chunkArray } from "#app/utils/chunk-array.ts";
import { prisma } from "#app/utils/db.server.ts";
import {
  bumpUserPlaylistUpdatedAt,
  userPlaylistTitleTaken,
} from "#app/utils/user-playlist.server.ts";

export type PromoteOnRepeatSnapshotResult =
  | {
      status: "success";
      playlist: { id: string; title: string };
      addedCount: number;
      skippedCount: number;
    }
  | { status: "not_found" }
  | { status: "invalid_title" }
  | { status: "duplicate_title"; existingTitle: string }
  | { status: "target_not_found" };

type PromoteCreateInput = {
  userId: string;
  snapshotId: string;
  mode: "create";
  title: string;
};

type PromoteAddInput = {
  userId: string;
  snapshotId: string;
  mode: "add";
  targetPlaylistId: string;
};

export type PromoteOnRepeatSnapshotInput = PromoteCreateInput | PromoteAddInput;

async function loadSnapshotTrackIds(userId: string, snapshotId: string) {
  const snapshot = await prisma.onRepeatSnapshot.findFirst({
    where: { id: snapshotId, userId },
    select: {
      id: true,
      tracks: {
        orderBy: { position: "asc" },
        select: { trackId: true },
      },
    },
  });
  if (!snapshot) return null;
  return snapshot.tracks.map((t) => t.trackId);
}

/**
 * Copy all On-Repeat Snapshot tracks into a new or existing UserPlaylist.
 * The snapshot itself is unchanged (read-only).
 */
export async function promoteOnRepeatSnapshot(
  input: PromoteOnRepeatSnapshotInput,
): Promise<PromoteOnRepeatSnapshotResult> {
  const trackIds = await loadSnapshotTrackIds(input.userId, input.snapshotId);
  if (!trackIds) {
    return { status: "not_found" };
  }

  if (input.mode === "create") {
    const trimmedTitle = input.title.trim();
    if (!trimmedTitle) {
      return { status: "invalid_title" };
    }

    const duplicate = await userPlaylistTitleTaken({
      userId: input.userId,
      title: trimmedTitle,
    });
    if (duplicate.taken) {
      return {
        status: "duplicate_title",
        existingTitle: duplicate.existingTitle ?? trimmedTitle,
      };
    }

    const playlist = await prisma.$transaction(async (tx) => {
      const created = await tx.userPlaylist.create({
        data: { title: trimmedTitle, ownerId: input.userId },
        select: { id: true, title: true },
      });

      let position = 0;
      for (const chunk of chunkArray(trackIds)) {
        await tx.userPlaylistTrack.createMany({
          data: chunk.map((trackId) => ({
            playlistId: created.id,
            trackId,
            position: position++,
          })),
        });
      }

      return created;
    });

    return {
      status: "success",
      playlist,
      addedCount: trackIds.length,
      skippedCount: 0,
    };
  }

  const targetPlaylist = await prisma.userPlaylist.findFirst({
    where: { id: input.targetPlaylistId, ownerId: input.userId },
    select: { id: true, title: true },
  });
  if (!targetPlaylist) {
    return { status: "target_not_found" };
  }

  const existingTracks = await prisma.userPlaylistTrack.findMany({
    where: {
      playlistId: targetPlaylist.id,
      trackId: { in: trackIds },
    },
    select: { trackId: true },
  });
  const existingSet = new Set(existingTracks.map((et) => et.trackId));
  const newTrackIds = trackIds.filter((id) => !existingSet.has(id));
  const skippedCount = trackIds.length - newTrackIds.length;

  if (newTrackIds.length === 0) {
    return {
      status: "success",
      playlist: targetPlaylist,
      addedCount: 0,
      skippedCount,
    };
  }

  const maxPosition = await prisma.userPlaylistTrack.aggregate({
    where: { playlistId: targetPlaylist.id },
    _max: { position: true },
  });
  let nextPosition = (maxPosition._max.position ?? -1) + 1;

  for (const chunk of chunkArray(newTrackIds)) {
    await prisma.userPlaylistTrack.createMany({
      data: chunk.map((trackId) => ({
        playlistId: targetPlaylist.id,
        trackId,
        position: nextPosition++,
      })),
    });
  }

  await bumpUserPlaylistUpdatedAt({
    playlistId: targetPlaylist.id,
    userId: input.userId,
  });

  return {
    status: "success",
    playlist: targetPlaylist,
    addedCount: newTrackIds.length,
    skippedCount,
  };
}
