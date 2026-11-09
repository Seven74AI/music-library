import { chunkArray } from "#app/utils/chunk-array.ts";
import { prisma } from "#app/utils/db.server.ts";

/** Duck-typed so we don't depend on Prisma runtime internals for one error code. */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export type AddTrackToUserPlaylistInput = {
  userId: string;
  playlistId: string;
  trackId: string;
  forceDuplicate?: boolean;
};

export type AddTrackToUserPlaylistResult =
  | { status: "success"; playlistTitle: string }
  | { status: "not_found" }
  | {
      status: "duplicate";
      playlistId: string;
      playlistTitle: string;
    };

export type UserPlaylistSummary = {
  id: string;
  title: string;
  description: string | null;
  _count: { tracks: number };
};

export type CreateUserPlaylistResult =
  | { status: "success"; playlist: UserPlaylistSummary }
  | { status: "invalid_title" }
  | { status: "duplicate_title"; existingTitle: string };

export type CreateUserPlaylistWithTrackResult =
  | { status: "success"; playlist: UserPlaylistSummary }
  | { status: "invalid_title" }
  | { status: "duplicate_title"; existingTitle: string };

export function normalizeUserPlaylistTitle(title: string): string {
  return title.trim().toLowerCase();
}

export async function userPlaylistTitleTaken({
  userId,
  title,
  excludePlaylistId,
}: {
  userId: string;
  title: string;
  excludePlaylistId?: string;
}): Promise<{ taken: boolean; existingTitle?: string }> {
  const normalized = normalizeUserPlaylistTitle(title);
  if (!normalized) {
    return { taken: false };
  }

  const playlists = await prisma.userPlaylist.findMany({
    where: { ownerId: userId },
    select: { id: true, title: true },
  });

  const match = playlists.find(
    (playlist) =>
      playlist.id !== excludePlaylistId &&
      normalizeUserPlaylistTitle(playlist.title) === normalized,
  );

  if (!match) {
    return { taken: false };
  }

  return { taken: true, existingTitle: match.title };
}

export async function createUserPlaylist({
  userId,
  title,
  description,
}: {
  userId: string;
  title: string;
  description?: string | null;
}): Promise<CreateUserPlaylistResult> {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    return { status: "invalid_title" };
  }

  const duplicate = await userPlaylistTitleTaken({ userId, title: trimmedTitle });
  if (duplicate.taken) {
    return {
      status: "duplicate_title",
      existingTitle: duplicate.existingTitle ?? trimmedTitle,
    };
  }

  try {
    const playlist = await prisma.userPlaylist.create({
      data: {
        title: trimmedTitle,
        description: description?.trim() || null,
        ownerId: userId,
      },
      select: {
        id: true,
        title: true,
        description: true,
        _count: { select: { tracks: true } },
      },
    });

    return { status: "success", playlist };
  } catch (error) {
    // The DB unique index (ownerId, lower(trim(title))) is the atomic guard:
    // a concurrent create with a case-insensitively equal title throws P2002.
    if (isUniqueConstraintViolation(error)) {
      return { status: "duplicate_title", existingTitle: trimmedTitle };
    }
    throw error;
  }
}

export async function createUserPlaylistWithTrack({
  userId,
  title,
  trackId,
}: {
  userId: string;
  title: string;
  trackId: string;
}): Promise<CreateUserPlaylistWithTrackResult> {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    return { status: "invalid_title" };
  }

  const duplicate = await userPlaylistTitleTaken({ userId, title: trimmedTitle });
  if (duplicate.taken) {
    return {
      status: "duplicate_title",
      existingTitle: duplicate.existingTitle ?? trimmedTitle,
    };
  }

  try {
    const playlist = await prisma.$transaction(async (tx) => {
      const created = await tx.userPlaylist.create({
        data: {
          title: trimmedTitle,
          description: null,
          ownerId: userId,
        },
        select: { id: true, title: true, description: true },
      });

      const existing = await tx.userPlaylistTrack.findFirst({
        where: { playlistId: created.id, trackId },
      });
      if (existing) {
        throw new Error(`Failed to add track after playlist create: duplicate`);
      }

      const maxPosition = await tx.userPlaylistTrack.aggregate({
        where: { playlistId: created.id },
        _max: { position: true },
      });
      const nextPosition = (maxPosition._max.position ?? -1) + 1;

      await tx.userPlaylistTrack.createMany({
        data: [{ playlistId: created.id, trackId, position: nextPosition }],
      });

      await tx.userPlaylist.update({
        where: { id: created.id, ownerId: userId },
        data: { updatedAt: new Date() },
      });

      return created;
    });

    return {
      status: "success",
      playlist: {
        ...playlist,
        _count: { tracks: 1 },
      },
    };
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      return { status: "duplicate_title", existingTitle: trimmedTitle };
    }
    throw error;
  }
}

/**
 * Bumps a user playlist's `updatedAt` so "last modified" sorting reflects
 * content changes (add/remove/reorder), not just renames or creation.
 * `@updatedAt` auto-tracks the change; we touch it explicitly because
 * content mutations only write to `UserPlaylistTrack`, never the parent row.
 */
export async function bumpUserPlaylistUpdatedAt({
  playlistId,
  userId,
}: {
  playlistId: string;
  userId: string;
}): Promise<void> {
  await prisma.userPlaylist.update({
    where: { id: playlistId, ownerId: userId },
    data: { updatedAt: new Date() },
  });
}

/**
 * Appends tracks at the next sequential positions. MAX(position) and inserts
 * run in one `$transaction` (serialized by the SQLite adapter mutex).
 */
export async function appendTracksToUserPlaylistAtNextPositions({
  playlistId,
  trackIds,
}: {
  playlistId: string;
  trackIds: string[];
}): Promise<void> {
  if (trackIds.length === 0) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    const maxPosition = await tx.userPlaylistTrack.aggregate({
      where: { playlistId },
      _max: { position: true },
    });
    let nextPosition = (maxPosition._max.position ?? -1) + 1;

    for (const chunk of chunkArray(trackIds)) {
      await tx.userPlaylistTrack.createMany({
        data: chunk.map((trackId) => ({
          playlistId,
          trackId,
          position: nextPosition++,
        })),
      });
    }
  });
}

export async function addTrackToUserPlaylist({
  userId,
  playlistId,
  trackId,
  forceDuplicate = false,
}: AddTrackToUserPlaylistInput): Promise<AddTrackToUserPlaylistResult> {
  const playlist = await prisma.userPlaylist.findFirst({
    where: { id: playlistId, ownerId: userId },
    select: { id: true, title: true },
  });

  if (!playlist) {
    return { status: "not_found" };
  }

  const insertResult = await prisma.$transaction(async (tx) => {
    if (!forceDuplicate) {
      const existing = await tx.userPlaylistTrack.findFirst({
        where: { playlistId, trackId },
      });

      if (existing) {
        return { status: "duplicate" as const };
      }
    }

    const maxPosition = await tx.userPlaylistTrack.aggregate({
      where: { playlistId },
      _max: { position: true },
    });
    const nextPosition = (maxPosition._max.position ?? -1) + 1;

    await tx.userPlaylistTrack.createMany({
      data: [{ playlistId, trackId, position: nextPosition }],
    });

    return { status: "success" as const };
  });

  if (insertResult.status === "duplicate") {
    return {
      status: "duplicate",
      playlistId,
      playlistTitle: playlist.title,
    };
  }

  await bumpUserPlaylistUpdatedAt({ playlistId, userId });

  return { status: "success", playlistTitle: playlist.title };
}

export type RemoveTrackFromUserPlaylistInput = {
  userId: string;
  playlistId: string;
  trackId: string;
};

export type RemoveTrackFromUserPlaylistResult =
  | { status: "success"; playlistTitle: string; removedCount: number }
  | { status: "not_found" }
  | { status: "not_in_playlist"; playlistTitle: string };

/**
 * Removes every occurrence of a track from a user-owned playlist.
 * Used by AddToPlaylistMenu when the track is already present and the user
 * chooses to delete it rather than add a duplicate.
 */
export async function removeTrackFromUserPlaylist({
  userId,
  playlistId,
  trackId,
}: RemoveTrackFromUserPlaylistInput): Promise<RemoveTrackFromUserPlaylistResult> {
  const playlist = await prisma.userPlaylist.findFirst({
    where: { id: playlistId, ownerId: userId },
    select: { id: true, title: true },
  });

  if (!playlist) {
    return { status: "not_found" };
  }

  const { count } = await prisma.userPlaylistTrack.deleteMany({
    where: { playlistId, trackId },
  });

  if (count === 0) {
    return { status: "not_in_playlist", playlistTitle: playlist.title };
  }

  await bumpUserPlaylistUpdatedAt({ playlistId, userId });

  return { status: "success", playlistTitle: playlist.title, removedCount: count };
}
