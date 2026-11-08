import { prisma } from "#app/utils/db.server.ts";
import {
  assertValidIdCursor,
  INVALID_CURSOR_FORMAT_MESSAGE,
} from "#app/utils/search-validation.server.ts";

export type PlaylistTracksQueryError = { kind: "error"; response: Response };
export type PlaylistTracksQueryOk = {
  kind: "ok";
  playlistId: string;
  cursor: string | null;
  limit: number;
};

export type PlaylistTracksQuery = PlaylistTracksQueryOk | PlaylistTracksQueryError;

/**
 * Parse + validate the shared pagination params for playlist-track loaders
 * (user playlists and service playlists). Mirrors the previous inline logic in
 * both loaders: `playlistId` required, `limit` in [1, 100] (default 50),
 * optional exclusive `cursor` (skip:1).
 */
export function parsePlaylistTracksQuery(url: URL): PlaylistTracksQuery {
  const playlistId = url.searchParams.get("playlistId");
  const cursor = url.searchParams.get("cursor");
  const limit = Number.parseInt(url.searchParams.get("limit") || "50", 10);

  if (!playlistId) {
    return {
      kind: "error",
      response: Response.json({ error: "Playlist ID is required" }, { status: 400 }),
    };
  }
  if (Number.isNaN(limit) || limit < 1 || limit > 100) {
    return {
      kind: "error",
      response: Response.json({ error: "Invalid limit parameter" }, { status: 400 }),
    };
  }
  return { kind: "ok", playlistId, cursor, limit };
}

export function playlistTracksPagination<T extends { id: string }>(rows: T[], limit: number) {
  const hasNext = rows.length > limit;
  const pageRows = hasNext ? rows.slice(0, limit) : rows;
  const nextCursor = hasNext ? (pageRows[pageRows.length - 1]?.id ?? null) : null;
  return { pageRows, hasNext, nextCursor, limit };
}

/** Fail closed when the cursor row is missing or belongs to another playlist. */
export async function assertPlaylistTrackCursorInScope({
  userId,
  playlistId,
  cursor,
  kind,
}: {
  userId: string;
  playlistId: string;
  cursor: string | null;
  kind: "user" | "service";
}): Promise<void> {
  assertValidIdCursor(cursor);
  if (!cursor) return;

  const inScope =
    kind === "user"
      ? await prisma.userPlaylistTrack.findFirst({
          where: { id: cursor, playlistId, playlist: { ownerId: userId } },
          select: { id: true },
        })
      : await prisma.servicePlaylistTrack.findFirst({
          where: { id: cursor, playlistId, playlist: { ownerId: userId } },
          select: { id: true },
        });

  if (!inScope) {
    throw new Error(INVALID_CURSOR_FORMAT_MESSAGE);
  }
}
