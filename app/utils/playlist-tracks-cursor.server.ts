import { prisma } from "#app/utils/db.server.ts";
import {
  assertValidIdCursor,
  INVALID_CURSOR_FORMAT_MESSAGE,
} from "#app/utils/search-validation.server.ts";

/** Validate a user-playlist track cursor belongs to the playlist and owner. */
export async function assertUserPlaylistTrackCursor(
  userId: string,
  playlistId: string,
  cursor: string,
): Promise<void> {
  assertValidIdCursor(cursor);
  const anchor = await prisma.userPlaylistTrack.findFirst({
    where: {
      id: cursor,
      playlistId,
      playlist: { ownerId: userId },
    },
    select: { id: true },
  });
  if (!anchor) {
    throw new Error(INVALID_CURSOR_FORMAT_MESSAGE);
  }
}

/** Validate a service-playlist track cursor belongs to the playlist and owner. */
export async function assertServicePlaylistTrackCursor(
  userId: string,
  playlistId: string,
  cursor: string,
): Promise<void> {
  assertValidIdCursor(cursor);
  const anchor = await prisma.servicePlaylistTrack.findFirst({
    where: {
      id: cursor,
      playlistId,
      playlist: { ownerId: userId },
    },
    select: { id: true },
  });
  if (!anchor) {
    throw new Error(INVALID_CURSOR_FORMAT_MESSAGE);
  }
}
