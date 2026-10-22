/**
 * Party Room catalog search — has-audio only, full archived catalog.
 * Gated by a valid RoomParticipant (caller must enforce seat + rate limit).
 */

import {
  type AlbumSearchResult,
  type ArtistSearchResult,
  type SearchResponse,
  type SearchResult,
  type TrackSearchResult,
} from "#app/types/search.ts";
import { prisma } from "#app/utils/db.server.ts";
import { escapeLikeLiterals, toLiteralFts5Query } from "#app/utils/fts5-query.server.ts";

function emptySearchResponse(limit: number): SearchResponse {
  return {
    results: [],
    pagination: { limit, hasNext: false, nextCursor: null },
  };
}

type CursorSortTuple = {
  rk: number;
  fr: number;
  n: string;
  id: string;
};

type HasAudioCursor = {
  t: CursorSortTuple | null;
  a: CursorSortTuple | null;
  ar: CursorSortTuple | null;
};

function decodeCursor(cursor: string): HasAudioCursor {
  const parsed = JSON.parse(Buffer.from(cursor, "base64").toString("utf-8")) as Record<
    string,
    unknown
  >;
  return {
    t: (parsed.t as CursorSortTuple) ?? null,
    a: (parsed.a as CursorSortTuple) ?? null,
    ar: (parsed.ar as CursorSortTuple) ?? null,
  };
}

function encodeCursor(c: HasAudioCursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64");
}

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

const HAS_AUDIO_TRACK = `EXISTS (
  SELECT 1 FROM "TrackAudioFile" taf WHERE taf."trackId" = t.id
)`;

const HAS_AUDIO_ALBUM = `EXISTS (
  SELECT 1 FROM "Track" t
  JOIN "TrackAudioFile" taf ON taf."trackId" = t.id
  WHERE t."albumId" = alb.id
)`;

const HAS_AUDIO_ARTIST = `EXISTS (
  SELECT 1 FROM "Track" t
  JOIN "TrackAudioFile" taf ON taf."trackId" = t.id
  WHERE t."artistId" = a.id
)`;

export type RoomSearchType = "all" | "tracks" | "albums" | "artists";

async function searchHasAudioTracks(
  query: string,
  limit: number,
  cursor?: string,
  usePrefix = true,
): Promise<SearchResponse> {
  if (!query.trim()) return emptySearchResponse(limit);

  const ftsQuery = toLiteralFts5Query(query, { prefix: usePrefix });
  if (!ftsQuery) return emptySearchResponse(limit);

  const normalizedQuery = query.toLowerCase().trim();
  const cur = cursor ? decodeCursor(cursor) : null;
  const curT = cur?.t ?? null;
  const prefixPattern = `${escapeLikeLiterals(normalizedQuery)}%`;
  const sqlEscapedFtsQuery = ftsQuery.replace(/'/g, "''");
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
        WHEN LOWER(t.title) LIKE ? ESCAPE '\\' THEN 2
        ELSE 3
      END as relevance_rank,
      tracks_fts.rank as fts_rank
    FROM tracks_fts
    JOIN "Track" t ON tracks_fts.track_id = t.id
    JOIN "Artist" a ON t."artistId" = a.id
    LEFT JOIN "Album" alb ON t."albumId" = alb.id
    WHERE tracks_fts MATCH '${sqlEscapedFtsQuery}'
      AND ${HAS_AUDIO_TRACK}
      ${cursorFilter.sql}
    ORDER BY relevance_rank, fts_rank, t.title
    LIMIT ?`,
    normalizedQuery,
    prefixPattern,
    ...cursorFilter.params,
    limit + 1,
  );

  const hasNext = results.length > limit;
  const rawResults = results.slice(0, limit);
  const tracks: TrackSearchResult[] = rawResults.map((row) => ({
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
  }));

  // Enrich with audioFiles so the guest UI can show audition affordances.
  const enriched = await enrichWithAudioFiles(tracks);

  const lastRow = rawResults[rawResults.length - 1];
  const nextCursor: HasAudioCursor = {
    t: hasNext && lastRow ? lastCursorTuple(lastRow, "title") : null,
    a: cur?.a ?? null,
    ar: cur?.ar ?? null,
  };

  return {
    results: enriched,
    pagination: {
      limit,
      hasNext,
      nextCursor: hasNext ? encodeCursor(nextCursor) : null,
    },
  };
}

async function enrichWithAudioFiles(tracks: TrackSearchResult[]): Promise<TrackSearchResult[]> {
  if (tracks.length === 0) return tracks;
  const rows = await prisma.track.findMany({
    where: { id: { in: tracks.map((t) => t.id) } },
    select: {
      id: true,
      audioFiles: { select: { id: true, format: true, objectKey: true } },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r.audioFiles]));
  return tracks.map((t) => ({ ...t, audioFiles: byId.get(t.id) ?? [] }));
}

async function searchHasAudioAlbums(
  query: string,
  limit: number,
  cursor?: string,
  usePrefix = true,
): Promise<SearchResponse> {
  if (!query.trim()) return emptySearchResponse(limit);

  const ftsQuery = toLiteralFts5Query(query, { prefix: usePrefix });
  if (!ftsQuery) return emptySearchResponse(limit);

  const normalizedQuery = query.toLowerCase().trim();
  const cur = cursor ? decodeCursor(cursor) : null;
  const curA = cur?.a ?? null;
  const prefixPattern = `${escapeLikeLiterals(normalizedQuery)}%`;
  const sqlEscapedFtsQuery = ftsQuery.replace(/'/g, "''");
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
        WHEN LOWER(alb.name) LIKE ? ESCAPE '\\' THEN 2
        ELSE 3
      END as relevance_rank,
      albums_fts.rank as fts_rank
    FROM albums_fts
    JOIN "Album" alb ON albums_fts.album_id = alb.id
    JOIN "Artist" a ON alb."artistId" = a.id
    WHERE albums_fts MATCH '${sqlEscapedFtsQuery}'
      AND ${HAS_AUDIO_ALBUM}
      ${cursorFilter.sql}
    ORDER BY relevance_rank, fts_rank, alb.name
    LIMIT ?`,
    normalizedQuery,
    prefixPattern,
    ...cursorFilter.params,
    limit + 1,
  );

  const hasNext = results.length > limit;
  const rawResults = results.slice(0, limit);
  const albums: AlbumSearchResult[] = rawResults.map((row) => ({
    type: "album",
    id: row.id,
    name: row.name,
    artistName: row.artist_name,
    artistId: row.artist_id,
    year: row.year,
    coverImageId: row.coverImageId,
    relevance: Number(row.relevance_rank) * 1000 + Number(row.fts_rank),
  }));

  const lastRow = rawResults[rawResults.length - 1];
  const nextCursor: HasAudioCursor = {
    t: cur?.t ?? null,
    a: hasNext && lastRow ? lastCursorTuple(lastRow, "name") : null,
    ar: cur?.ar ?? null,
  };

  return {
    results: albums,
    pagination: {
      limit,
      hasNext,
      nextCursor: hasNext ? encodeCursor(nextCursor) : null,
    },
  };
}

async function searchHasAudioArtists(
  query: string,
  limit: number,
  cursor?: string,
  usePrefix = true,
): Promise<SearchResponse> {
  if (!query.trim()) return emptySearchResponse(limit);

  const ftsQuery = toLiteralFts5Query(query, { prefix: usePrefix });
  if (!ftsQuery) return emptySearchResponse(limit);

  const normalizedQuery = query.toLowerCase().trim();
  const cur = cursor ? decodeCursor(cursor) : null;
  const curAr = cur?.ar ?? null;
  const prefixPattern = `${escapeLikeLiterals(normalizedQuery)}%`;
  const sqlEscapedFtsQuery = ftsQuery.replace(/'/g, "''");
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
        WHEN LOWER(a.name) LIKE ? ESCAPE '\\' THEN 2
        ELSE 3
      END as relevance_rank,
      artists_fts.rank as fts_rank
    FROM artists_fts
    JOIN "Artist" a ON artists_fts.artist_id = a.id
    WHERE artists_fts MATCH '${sqlEscapedFtsQuery}'
      AND ${HAS_AUDIO_ARTIST}
      ${cursorFilter.sql}
    ORDER BY relevance_rank, fts_rank, a.name
    LIMIT ?`,
    normalizedQuery,
    prefixPattern,
    ...cursorFilter.params,
    limit + 1,
  );

  const hasNext = results.length > limit;
  const rawResults = results.slice(0, limit);
  const artists: ArtistSearchResult[] = rawResults.map((row) => ({
    type: "artist",
    id: row.id,
    name: row.name,
    genre: row.genre,
    relevance: Number(row.relevance_rank) * 1000 + Number(row.fts_rank),
  }));

  const lastRow = rawResults[rawResults.length - 1];
  const nextCursor: HasAudioCursor = {
    t: cur?.t ?? null,
    a: cur?.a ?? null,
    ar: hasNext && lastRow ? lastCursorTuple(lastRow, "name") : null,
  };

  return {
    results: artists,
    pagination: {
      limit,
      hasNext,
      nextCursor: hasNext ? encodeCursor(nextCursor) : null,
    },
  };
}

function mergeByRelevance(results: SearchResult[], limit: number): SearchResult[] {
  return [...results].sort((a, b) => (a.relevance ?? 0) - (b.relevance ?? 0)).slice(0, limit);
}

/**
 * Search the archived catalog for entities that have playable audio.
 * No My Library scope — room search is always the full has-audio catalog.
 */
export async function searchRoomCatalog(options: {
  query: string;
  limit?: number;
  cursor?: string;
  type?: RoomSearchType;
  usePrefix?: boolean;
}): Promise<SearchResponse> {
  const limit = options.limit ?? 20;
  const type = options.type ?? "all";
  const usePrefix = options.usePrefix ?? true;
  const { query, cursor } = options;

  if (type === "tracks") {
    return searchHasAudioTracks(query, limit, cursor, usePrefix);
  }
  if (type === "albums") {
    return searchHasAudioAlbums(query, limit, cursor, usePrefix);
  }
  if (type === "artists") {
    return searchHasAudioArtists(query, limit, cursor, usePrefix);
  }

  // Mixed: fetch a page from each type and merge (no playlist scope for guests).
  const perType = Math.max(1, Math.ceil(limit / 3));
  const [tracks, albums, artists] = await Promise.all([
    searchHasAudioTracks(query, perType, undefined, usePrefix),
    searchHasAudioAlbums(query, perType, undefined, usePrefix),
    searchHasAudioArtists(query, perType, undefined, usePrefix),
  ]);

  const merged = mergeByRelevance(
    [...tracks.results, ...albums.results, ...artists.results],
    limit + 1,
  );
  const hasNext = merged.length > limit;

  return {
    results: merged.slice(0, limit),
    pagination: { limit, hasNext, nextCursor: null },
  };
}

/** Pure helper used in unit tests — whether a track row qualifies as has-audio. */
export function trackHasAudioFiles(audioFileCount: number): boolean {
  return audioFileCount > 0;
}
