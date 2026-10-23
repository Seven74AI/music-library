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
  const hasNext = rows.length === limit;
  const nextCursor = hasNext ? rows[rows.length - 1]?.id : null;
  return { hasNext, nextCursor, limit };
}
