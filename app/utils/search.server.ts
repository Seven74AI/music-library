/**
 * Search utilities for global search across tracks, albums, artists, and playlists
 * Uses SQLite FTS5 for full-text search with content tables
 */

import {
  type AlbumSearchResult,
  type ArtistSearchResult,
  type PlaylistSearchResult,
  type SearchResult,
  type SearchResponse,
  type TrackSearchResult,
} from "#app/types/search.ts";
import { prisma } from "#app/utils/db.server.ts";

// ── Cursor pagination helpers ──

type CursorSortTuple = {
  rk: number; // relevance_rank
  fr: number; // fts_rank (0 for playlists)
  n: string; // name or title
  id: string; // entity id
};

type CompositeCursor = {
  t: CursorSortTuple | null;
  a: CursorSortTuple | null;
  ar: CursorSortTuple | null;
  p: CursorSortTuple | null;
};

function decodeCursor(cursor: string): CompositeCursor {
  const parsed = JSON.parse(Buffer.from(cursor, "base64").toString("utf-8")) as Record<
    string,
    unknown
  >;
  return {
    t: (parsed.t as CursorSortTuple) ?? null,
    a: (parsed.a as CursorSortTuple) ?? null,
    ar: (parsed.ar as CursorSortTuple) ?? null,
    p: (parsed.p as CursorSortTuple) ?? null,
  };
}

function encodeCursor(c: CompositeCursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64");
}

/** Build WHERE clause fragment + params for keyset pagination past the given tuple */
function cursorClause(
  tuple: CursorSortTuple,
  rankCol: string,
  ftsCol: string,
  nameCol: string,
  idCol: string,
): { sql: string; params: unknown[] } {
  return {
    sql: `AND (
      ${rankCol} > ? OR
      (${rankCol} = ? AND ${ftsCol} > ?) OR
      (${rankCol} = ? AND ${ftsCol} = ? AND ${nameCol} > ?) OR
      (${rankCol} = ? AND ${ftsCol} = ? AND ${nameCol} = ? AND ${idCol} > ?)
    )`,
    params: [
      tuple.rk,
      tuple.rk,
      tuple.fr,
      tuple.rk,
      tuple.fr,
      tuple.n,
      tuple.rk,
      tuple.fr,
      tuple.n,
      tuple.id,
    ],
  };
}

/** Extract sort-tuple from the last result row */
function lastCursorTuple(
  row: {
    relevance_rank: number;
    fts_rank: number | bigint;
    name?: string;
    title?: string;
    id: string;
  },
  nameField: string,
): CursorSortTuple {
  return {
    rk: Number(row.relevance_rank),
    fr: Number(row.fts_rank ?? 0),
    n: String(row[nameField as keyof typeof row] ?? ""),
    id: String(row.id),
  };
}

/**
 * Escape special characters in FTS5 query string
 * FTS5 has special characters: ", ', \, *, ?, and, or, not
 *
 * Security: This function prevents FTS5 query injection by escaping all special characters.
 * Note: We don't escape * here because we use it for prefix matching, but the query
 * is validated before reaching this function to ensure it doesn't contain malicious content.
 *
 * @param query - User input query (must be pre-validated)
 * @param allowPrefix - Whether to allow * for prefix matching
 * @returns Escaped FTS5 query string safe for use in MATCH clause
 */
function escapeFts5Query(query: string, allowPrefix: boolean = false): string {
  // Security: Normalize and trim first to prevent whitespace-based attacks
  let escaped = query
    .replace(/\s+/g, " ") // Normalize whitespace (prevents whitespace-based attacks)
    .trim();

  // Security: Escape all FTS5 special characters to prevent query injection
  // Double quotes must be doubled for FTS5
  escaped = escaped.replace(/"/g, '""');
  // Single quotes must be doubled for SQL string literals
  escaped = escaped.replace(/'/g, "''");
  // Backslashes must be escaped
  escaped = escaped.replace(/\\/g, "\\\\");
  // Question marks must be escaped (used for phrase queries)
  escaped = escaped.replace(/\?/g, "\\?");

  // Security: Escape boolean operators to prevent query manipulation
  // These are case-insensitive in FTS5, so we escape them regardless of case
  escaped = escaped.replace(/\b(AND|OR|NOT)\b/gi, (match) => `"${match}"`);

  // Only escape * if we're not using prefix matching
  // When allowPrefix is true, we'll add * ourselves in buildFts5Query
  if (!allowPrefix) {
    escaped = escaped.replace(/\*/g, "\\*");
  }

  return escaped;
}

/**
 * Build FTS5 query string with optional prefix matching
 * By default, enables prefix matching for better typeahead/search-as-you-type behavior
 *
 * Security: The input query must be pre-validated using validateSearchQuery()
 * to prevent injection attacks and DoS.
 *
 * @param query - Pre-validated search query
 * @param usePrefix - Whether to enable prefix matching (default: true)
 * @returns Safe FTS5 query string for use in MATCH clause
 */
function buildFts5Query(query: string, usePrefix: boolean = true): string {
  // Security: Query should already be validated, but double-check it's not empty
  if (!query || !query.trim()) return "";

  // Escape the query, but allow * if we're using prefix matching
  const escaped = escapeFts5Query(query, usePrefix);
  if (!escaped) return "";

  // For prefix queries, append * to each word to match partial words
  // This allows "m" to match "meryl", "metal", etc.
  // Security: We only add * to words that don't already have it (to prevent double *)
  if (usePrefix) {
    return escaped
      .split(/\s+/)
      .filter((word) => word.length > 0) // Remove empty strings
      .map((word) => {
        // Security: Don't add * if word already ends with * (prevent double *)
        return word.endsWith("*") ? word : `${word}*`;
      })
      .join(" ");
  }
  return escaped;
}

async function enrichTrackSearchResults(
  tracks: TrackSearchResult[],
  userId?: string,
): Promise<TrackSearchResult[]> {
  if (tracks.length === 0) {
    return tracks;
  }

  const trackIds = tracks.map((track) => track.id);
  const enrichedRows = await prisma.track.findMany({
    where: { id: { in: trackIds } },
    select: {
      id: true,
      serviceUrl: true,
      coverImage: {
        select: {
          objectKey: true,
        },
      },
      service: {
        select: {
          displayName: true,
          logoUrl: true,
        },
      },
      audioFiles: {
        select: {
          id: true,
          format: true,
          objectKey: true,
        },
      },
      userTracks: userId
        ? {
            where: { userId, isActive: true },
            select: { createdAt: true },
            take: 1,
          }
        : false,
    },
  });

  const enrichedById = new Map(enrichedRows.map((row) => [row.id, row]));

  return tracks.map((track) => {
    const enriched = enrichedById.get(track.id);
    if (!enriched) {
      return {
        ...track,
        serviceUrl: null,
        coverImage: null,
        service: null,
        audioFiles: [],
      };
    }

    return {
      ...track,
      serviceUrl: enriched.serviceUrl,
      coverImage: enriched.coverImage,
      service: enriched.service
        ? {
            displayName: enriched.service.displayName,
            logoUrl: enriched.service.logoUrl,
          }
        : null,
      audioFiles: enriched.audioFiles,
      addedAt: enriched.userTracks?.[0]?.createdAt.toISOString(),
    };
  });
}

/**
 * Search tracks using FTS5, optionally scoped to a user's library
 *
 * Security: All parameters must be pre-validated using validation functions
 * from search-validation.server.ts to prevent SQL injection and DoS attacks.
 *
 * @param query - Pre-validated search query
 * @param limit - Pre-validated limit (1-100)
 * @param cursor - Pre-validated cursor (optional)
 * @param usePrefix - Whether to use prefix matching
 * @param userId - Optional user ID to scope results to the user's library via UserTrack
 * @returns Search results with pagination
 */
export async function searchTracks(
  query: string,
  limit: number = 20,
  cursor?: string,
  usePrefix: boolean = true,
  userId?: string,
): Promise<SearchResponse> {
  if (!query || !query.trim()) {
    return { results: [], pagination: { limit, hasNext: false, nextCursor: null } };
  }

  const ftsQuery = buildFts5Query(query, usePrefix);
  const normalizedQuery = query.toLowerCase().trim();
  const cur = cursor ? decodeCursor(cursor) : null;
  const curT = cur?.t ?? null;

  const prefixPattern = `${normalizedQuery}%`;
  const sqlEscapedFtsQuery = ftsQuery.replace(/'/g, "''");

  const userTrackJoin = userId
    ? `JOIN "UserTrack" ut ON ut."trackId" = t.id AND ut."userId" = '${userId.replace(/'/g, "''")}' AND ut."isActive" = true`
    : "";

  const cursorFilter = curT
    ? cursorClause(curT, "relevance_rank", "fts_rank", "t.title", "t.id")
    : { sql: "", params: [] as unknown[] };

  const results = await prisma.$queryRawUnsafe<
    Array<{
      type: string;
      id: string;
      title: string;
      artist_name: string;
      artist_id: string;
      album_name: string | null;
      album_id: string | null;
      duration: number | null;
      coverImageId: string | null;
      serviceId: string | null;
      relevance_rank: number;
      fts_rank: number;
    }>
  >(
    `SELECT 
			'track' as type,
			t.id,
			t.title,
			a.name as artist_name,
			a.id as artist_id,
			COALESCE(alb.name, '') as album_name,
			alb.id as album_id,
			t.duration,
			t."coverImageId",
			t."serviceId",
			CASE 
				WHEN LOWER(t.title) = ? THEN 1
				WHEN LOWER(t.title) LIKE ? THEN 2
				ELSE 3
			END as relevance_rank,
			tracks_fts.rank as fts_rank
		FROM tracks_fts
		JOIN "Track" t ON tracks_fts.track_id = t.id
		JOIN "Artist" a ON t."artistId" = a.id
		LEFT JOIN "Album" alb ON t."albumId" = alb.id
		${userTrackJoin}
		WHERE tracks_fts MATCH '${sqlEscapedFtsQuery}'${cursorFilter.sql}
		ORDER BY relevance_rank, fts_rank, t.title
		LIMIT ?`,
    normalizedQuery,
    prefixPattern,
    ...cursorFilter.params,
    limit + 1,
  );

  const hasNext = results.length > limit;
  const rawResults = results.slice(0, limit);
  const tracks = rawResults.map(
    (row): TrackSearchResult => ({
      type: "track",
      id: row.id,
      title: row.title,
      artistName: row.artist_name,
      artistId: row.artist_id,
      albumName: row.album_name || null,
      albumId: row.album_id || null,
      duration: row.duration,
      coverImageId: row.coverImageId,
      serviceId: row.serviceId,
      relevance: Number(row.relevance_rank) * 1000 + Number(row.fts_rank),
    }),
  );

  const enrichedTracks = await enrichTrackSearchResults(tracks, userId);

  const lastRow = rawResults[rawResults.length - 1];
  const newT = hasNext && lastRow ? lastCursorTuple(lastRow, "title") : null;
  const nextCursor: CompositeCursor = {
    t: newT,
    a: cur?.a ?? null,
    ar: cur?.ar ?? null,
    p: cur?.p ?? null,
  };

  return {
    results: enrichedTracks,
    pagination: { limit, hasNext, nextCursor: hasNext ? encodeCursor(nextCursor) : null },
  };
}

/**
 * Search albums using FTS5, optionally scoped to a user's library
 */
export async function searchAlbums(
  query: string,
  limit: number = 20,
  cursor?: string,
  usePrefix: boolean = true,
  userId?: string,
): Promise<SearchResponse> {
  if (!query.trim()) {
    return { results: [], pagination: { limit, hasNext: false, nextCursor: null } };
  }

  const ftsQuery = buildFts5Query(query, usePrefix);
  const normalizedQuery = query.toLowerCase().trim();
  const cur = cursor ? decodeCursor(cursor) : null;
  const curA = cur?.a ?? null;

  const prefixPattern = `${normalizedQuery}%`;
  const sqlEscapedFtsQuery = ftsQuery.replace(/'/g, "''");

  const userTrackJoin = userId
    ? `JOIN "UserTrack" ut ON ut."trackId" = t.id AND ut."userId" = '${userId.replace(/'/g, "''")}' AND ut."isActive" = true`
    : "";
  const albumUserJoin = userId
    ? `AND EXISTS (SELECT 1 FROM "Track" t2 JOIN "UserTrack" ut2 ON ut2."trackId" = t2.id WHERE t2."albumId" = alb.id AND ut2."userId" = '${userId.replace(/'/g, "''")}' AND ut2."isActive" = true)`
    : "";

  const cursorFilter = curA
    ? cursorClause(curA, "relevance_rank", "fts_rank", "alb.name", "alb.id")
    : { sql: "", params: [] as unknown[] };

  const results = await prisma.$queryRawUnsafe<
    Array<{
      type: string;
      id: string;
      name: string;
      artist_name: string;
      artist_id: string;
      year: number | null;
      coverImageId: string | null;
      relevance_rank: number;
      fts_rank: number;
    }>
  >(
    `SELECT 
			'album' as type,
			alb.id,
			alb.name,
			a.name as artist_name,
			a.id as artist_id,
			alb.year,
			alb."coverImageId",
			CASE 
				WHEN LOWER(alb.name) = ? THEN 1
				WHEN LOWER(alb.name) LIKE ? THEN 2
				ELSE 3
			END as relevance_rank,
			albums_fts.rank as fts_rank
		FROM albums_fts
		JOIN "Album" alb ON albums_fts.album_id = alb.id
		JOIN "Artist" a ON alb."artistId" = a.id
		WHERE albums_fts MATCH '${sqlEscapedFtsQuery}'${albumUserJoin}${cursorFilter.sql}
		ORDER BY relevance_rank, fts_rank, alb.name
		LIMIT ?`,
    normalizedQuery,
    prefixPattern,
    ...cursorFilter.params,
    limit + 1,
  );

  const hasNext = results.length > limit;
  const rawResults = results.slice(0, limit);
  const albums = rawResults.map(
    (row): AlbumSearchResult => ({
      type: "album",
      id: row.id,
      name: row.name,
      artistName: row.artist_name,
      artistId: row.artist_id,
      year: row.year,
      coverImageId: row.coverImageId,
      relevance: Number(row.relevance_rank) * 1000 + Number(row.fts_rank),
    }),
  );

  const lastRow = rawResults[rawResults.length - 1];
  const newA = hasNext && lastRow ? lastCursorTuple(lastRow, "name") : null;
  const nextCursor: CompositeCursor = {
    t: cur?.t ?? null,
    a: newA,
    ar: cur?.ar ?? null,
    p: cur?.p ?? null,
  };

  return {
    results: albums,
    pagination: { limit, hasNext, nextCursor: hasNext ? encodeCursor(nextCursor) : null },
  };
}

/**
 * Search artists using FTS5, optionally scoped to a user's library
 */
export async function searchArtists(
  query: string,
  limit: number = 20,
  cursor?: string,
  usePrefix: boolean = true,
  userId?: string,
): Promise<SearchResponse> {
  if (!query.trim()) {
    return { results: [], pagination: { limit, hasNext: false, nextCursor: null } };
  }

  const ftsQuery = buildFts5Query(query, usePrefix);
  const normalizedQuery = query.toLowerCase().trim();
  const cur = cursor ? decodeCursor(cursor) : null;
  const curAr = cur?.ar ?? null;

  const prefixPattern = `${normalizedQuery}%`;
  const sqlEscapedFtsQuery = ftsQuery.replace(/'/g, "''");

  const artistUserJoin = userId
    ? `AND EXISTS (SELECT 1 FROM "Track" t2 JOIN "UserTrack" ut2 ON ut2."trackId" = t2.id WHERE t2."artistId" = a.id AND ut2."userId" = '${userId.replace(/'/g, "''")}' AND ut2."isActive" = true)`
    : "";

  const cursorFilter = curAr
    ? cursorClause(curAr, "relevance_rank", "fts_rank", "a.name", "a.id")
    : { sql: "", params: [] as unknown[] };

  const results = await prisma.$queryRawUnsafe<
    Array<{
      type: string;
      id: string;
      name: string;
      genre: string | null;
      relevance_rank: number;
      fts_rank: number;
    }>
  >(
    `SELECT 
			'artist' as type,
			a.id,
			a.name,
			a.genre,
			CASE 
				WHEN LOWER(a.name) = ? THEN 1
				WHEN LOWER(a.name) LIKE ? THEN 2
				ELSE 3
			END as relevance_rank,
			artists_fts.rank as fts_rank
		FROM artists_fts
		JOIN "Artist" a ON artists_fts.artist_id = a.id
		WHERE artists_fts MATCH '${sqlEscapedFtsQuery}'${artistUserJoin}${cursorFilter.sql}
		ORDER BY relevance_rank, fts_rank, a.name
		LIMIT ?`,
    normalizedQuery,
    prefixPattern,
    ...cursorFilter.params,
    limit + 1,
  );

  const hasNext = results.length > limit;
  const rawResults = results.slice(0, limit);
  const artists = rawResults.map(
    (row): ArtistSearchResult => ({
      type: "artist",
      id: row.id,
      name: row.name,
      genre: row.genre,
      relevance: Number(row.relevance_rank) * 1000 + Number(row.fts_rank),
    }),
  );

  const lastRow = rawResults[rawResults.length - 1];
  const newAr = hasNext && lastRow ? lastCursorTuple(lastRow, "name") : null;
  const nextCursor: CompositeCursor = {
    t: cur?.t ?? null,
    a: cur?.a ?? null,
    ar: newAr,
    p: cur?.p ?? null,
  };

  return {
    results: artists,
    pagination: { limit, hasNext, nextCursor: hasNext ? encodeCursor(nextCursor) : null },
  };
}

/**
 * Search playlists using plain SQL LIKE
 * Playlists are user-owned, so this search is scoped to the authenticated user.
 * Unlike tracks/albums/artists which use FTS5 for full-text search,
 * playlists use a simple LIKE query on the title.
 *
 * @param query - Pre-validated search query
 * @param userId - The authenticated user's ID (required for user scoping)
 * @param limit - Pre-validated limit (1-100)
 * @param cursor - Pre-validated cursor (optional)
 * @param usePrefix - Whether to use prefix matching (LIKE 'query%' vs LIKE '%query%')
 * @returns Search results with pagination
 */
export async function searchPlaylists(
  query: string,
  userId: string,
  limit: number = 20,
  cursor?: string,
  usePrefix: boolean = true,
): Promise<SearchResponse> {
  if (!query.trim() || !userId) {
    return { results: [], pagination: { limit, hasNext: false, nextCursor: null } };
  }

  const normalizedQuery = query.toLowerCase().trim();
  const likePattern = `%${normalizedQuery}%`;
  const cur = cursor ? decodeCursor(cursor) : null;
  const curP = cur?.p ?? null;

  const cursorFilter = curP
    ? cursorClause({ ...curP, fr: 0 }, "relevance_rank", "0", "up.title", "up.id")
    : { sql: "", params: [] as unknown[] };

  const results = await prisma.$queryRawUnsafe<
    Array<{
      type: string;
      id: string;
      name: string;
      track_count: number;
      owner_name: string;
      description: string | null;
      item_count: number;
      thumbnail_url: string | null;
      relevance_rank: number;
      fts_rank: number;
    }>
  >(
    `SELECT 
			'playlist' as type,
			up.id,
			up.title as name,
			(SELECT COUNT(*) FROM "UserPlaylistTrack" upt WHERE upt."playlistId" = up.id) as track_count,
			u.name as owner_name,
			up.description,
			(SELECT COUNT(*) FROM "UserPlaylistTrack" upt WHERE upt."playlistId" = up.id) as item_count,
			NULL as thumbnail_url,
			CASE 
				WHEN LOWER(up.title) = ? THEN 1
				WHEN LOWER(up.title) LIKE ? THEN 2
				ELSE 3
			END as relevance_rank,
			0 as fts_rank
		FROM "UserPlaylist" up
		JOIN "User" u ON up."ownerId" = u.id
		WHERE up."ownerId" = ?
		AND LOWER(up.title) LIKE ?${cursorFilter.sql}
		ORDER BY relevance_rank, up.title
		LIMIT ?`,
    normalizedQuery,
    likePattern,
    userId,
    likePattern,
    ...cursorFilter.params,
    limit + 1,
  );

  const hasNext = results.length > limit;
  const rawResults = results.slice(0, limit);
  const playlists = rawResults.map(
    (row): PlaylistSearchResult => ({
      type: "playlist",
      id: row.id,
      name: row.name,
      trackCount: Number(row.track_count),
      ownerName: row.owner_name,
      description: row.description,
      itemCount: Number(row.item_count),
      thumbnailUrl: row.thumbnail_url,
      relevance: Number(row.relevance_rank),
    }),
  );

  const lastRow = rawResults[rawResults.length - 1];
  const newP = hasNext && lastRow ? lastCursorTuple(lastRow, "name") : null;
  const nextCursor: CompositeCursor = {
    t: cur?.t ?? null,
    a: cur?.a ?? null,
    ar: cur?.ar ?? null,
    p: newP,
  };

  return {
    results: playlists,
    pagination: { limit, hasNext, nextCursor: hasNext ? encodeCursor(nextCursor) : null },
  };
}

/**
 * Unified search across all entity types
 * Searches tracks, albums, artists, and playlists in parallel
 */
export async function searchAll(
  query: string,
  limit: number = 20,
  cursor?: string,
  type?: "all" | "tracks" | "albums" | "artists" | "playlists",
  usePrefix: boolean = true,
  userId?: string,
): Promise<SearchResponse> {
  if (!query.trim()) {
    return { results: [], pagination: { limit, hasNext: false, nextCursor: null } };
  }

  // Fetch limit results from each type to ensure we have enough candidates
  // Then combine and take the top N by relevance for better result quality
  const trackLimit = type === "all" || type === "tracks" ? limit : 0;
  const albumLimit = type === "all" || type === "albums" ? limit : 0;
  const artistLimit = type === "all" || type === "artists" ? limit : 0;
  const playlistLimit = type === "all" || type === "playlists" ? limit : 0;

  // Search all types in parallel
  const [tracksResult, albumsResult, artistsResult, playlistsResult] = await Promise.all([
    trackLimit > 0
      ? searchTracks(query, trackLimit, cursor, usePrefix, userId)
      : Promise.resolve({
          results: [],
          pagination: { limit: 0, hasNext: false, nextCursor: null },
        }),
    albumLimit > 0
      ? searchAlbums(query, albumLimit, cursor, usePrefix, userId)
      : Promise.resolve({
          results: [],
          pagination: { limit: 0, hasNext: false, nextCursor: null },
        }),
    artistLimit > 0
      ? searchArtists(query, artistLimit, cursor, usePrefix, userId)
      : Promise.resolve({
          results: [],
          pagination: { limit: 0, hasNext: false, nextCursor: null },
        }),
    playlistLimit > 0 && userId
      ? searchPlaylists(query, userId, playlistLimit, cursor, usePrefix)
      : Promise.resolve({
          results: [],
          pagination: { limit: 0, hasNext: false, nextCursor: null },
        }),
  ]);

  // Combine and sort by relevance
  const allResults: SearchResult[] = [
    ...tracksResult.results,
    ...albumsResult.results,
    ...artistsResult.results,
    ...playlistsResult.results,
  ].sort((a, b) => a.relevance - b.relevance);

  // Take top N results
  const results = allResults.slice(0, limit);
  const hasNext =
    allResults.length > limit ||
    tracksResult.pagination.hasNext ||
    albumsResult.pagination.hasNext ||
    artistsResult.pagination.hasNext ||
    playlistsResult.pagination.hasNext;

  // Combine per-function cursors into a composite
  const tCur = tracksResult.pagination.nextCursor
    ? decodeCursor(tracksResult.pagination.nextCursor).t
    : null;
  const aCur = albumsResult.pagination.nextCursor
    ? decodeCursor(albumsResult.pagination.nextCursor).a
    : null;
  const arCur = artistsResult.pagination.nextCursor
    ? decodeCursor(artistsResult.pagination.nextCursor).ar
    : null;
  const pCur = playlistsResult.pagination.nextCursor
    ? decodeCursor(playlistsResult.pagination.nextCursor).p
    : null;
  const nextCursor: CompositeCursor = { t: tCur, a: aCur, ar: arCur, p: pCur };

  return {
    results,
    pagination: { limit, hasNext, nextCursor: hasNext ? encodeCursor(nextCursor) : null },
  };
}
