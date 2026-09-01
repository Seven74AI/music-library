import { prisma } from "#app/utils/db.server.ts";

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

  const playlist = await prisma.userPlaylist.create({
    data: {
      title: trimmedTitle,
      description: null,
      ownerId: userId,
    },
    select: { id: true, title: true, description: true },
  });

  const addResult = await addTrackToUserPlaylist({
    userId,
    playlistId: playlist.id,
    trackId,
  });

  if (addResult.status !== "success") {
    await prisma.userPlaylist.delete({ where: { id: playlist.id } });
    throw new Error(`Failed to add track after playlist create: ${addResult.status}`);
  }

  return {
    status: "success",
    playlist: {
      ...playlist,
      _count: { tracks: 1 },
    },
  };
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

  if (!forceDuplicate) {
    const existing = await prisma.userPlaylistTrack.findFirst({
      where: { playlistId, trackId },
    });

    if (existing) {
      return {
        status: "duplicate",
        playlistId,
        playlistTitle: playlist.title,
      };
    }
  }

  const maxPosition = await prisma.userPlaylistTrack.aggregate({
    where: { playlistId },
    _max: { position: true },
  });

  await prisma.userPlaylistTrack.create({
    data: {
      playlistId,
      trackId,
      position: (maxPosition._max.position ?? -1) + 1,
    },
  });

  await bumpUserPlaylistUpdatedAt({ playlistId, userId });

  return { status: "success", playlistTitle: playlist.title };
}
