/**
 * Shared FTS5 search SQL builders and keyset cursor helpers.
 * Used by global search and party-room catalog search.
 */

import {
  decodeCursorArm,
  INVALID_CURSOR_FORMAT_MESSAGE,
  type CursorSortTuple,
} from "#app/utils/search-validation.server.ts";

export type SearchCursorArm = "t" | "a" | "ar" | "p";

export type SearchCursorState = Partial<Record<SearchCursorArm, CursorSortTuple | null>>;

/** Build WHERE clause fragment + params for keyset pagination past the given tuple */
export function cursorClause(
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
export function lastCursorTuple(
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

export function decodeSearchCursor(
  cursor: string,
  arms: readonly SearchCursorArm[],
): SearchCursorState {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64").toString("utf-8")) as Record<string, unknown>;
  } catch {
    throw new Error(INVALID_CURSOR_FORMAT_MESSAGE);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(INVALID_CURSOR_FORMAT_MESSAGE);
  }
  const state: SearchCursorState = {};
  for (const arm of arms) {
    state[arm] = decodeCursorArm(parsed, arm);
  }
  return state;
}

export function encodeSearchCursor(cursor: SearchCursorState): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64");
}

export type SqlParams = { sql: string; params: unknown[] };

export function buildTrackFtsQuery(options: {
  normalizedQuery: string;
  prefixPattern: string;
  ftsQuery: string;
  limit: number;
  cursorFilter: SqlParams;
  userTrackJoin: string;
  userTrackJoinParam?: string;
  extraWhereAfterMatch: string;
  ftsRankExpr: SqlParams;
}): SqlParams {
  const {
    normalizedQuery,
    prefixPattern,
    ftsQuery,
    limit,
    cursorFilter,
    userTrackJoin,
    userTrackJoinParam,
    extraWhereAfterMatch,
    ftsRankExpr,
  } = options;

  const sql = `SELECT 
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
			(${ftsRankExpr.sql}) as fts_rank
		FROM tracks_fts
		JOIN "Track" t ON tracks_fts.track_id = t.id
		JOIN "Artist" a ON t."artistId" = a.id
		LEFT JOIN "Album" alb ON t."albumId" = alb.id
		${userTrackJoin}
		WHERE tracks_fts MATCH ?${extraWhereAfterMatch}${cursorFilter.sql}
		ORDER BY relevance_rank, fts_rank, t.title, t.id
		LIMIT ?`;

  const params: unknown[] = [
    normalizedQuery,
    prefixPattern,
    ...ftsRankExpr.params,
    ...(userTrackJoinParam ? [userTrackJoinParam] : []),
    ftsQuery,
    ...cursorFilter.params,
    limit + 1,
  ];

  return { sql, params };
}

export function buildAlbumFtsQuery(options: {
  normalizedQuery: string;
  prefixPattern: string;
  ftsQuery: string;
  limit: number;
  cursorFilter: SqlParams;
  libraryScopeSql: string;
  libraryScopeParam?: string;
  extraWhereAfterMatch: string;
}): SqlParams {
  const {
    normalizedQuery,
    prefixPattern,
    ftsQuery,
    limit,
    cursorFilter,
    libraryScopeSql,
    libraryScopeParam,
    extraWhereAfterMatch,
  } = options;

  const sql = `SELECT 
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
		WHERE albums_fts MATCH ? AND alb."mergedIntoId" IS NULL ${libraryScopeSql}${extraWhereAfterMatch}${cursorFilter.sql}
		ORDER BY relevance_rank, fts_rank, alb.name, alb.id
		LIMIT ?`;

  const params: unknown[] = [
    normalizedQuery,
    prefixPattern,
    ftsQuery,
    ...(libraryScopeParam ? [libraryScopeParam] : []),
    ...cursorFilter.params,
    limit + 1,
  ];

  return { sql, params };
}

export function buildArtistFtsQuery(options: {
  normalizedQuery: string;
  prefixPattern: string;
  ftsQuery: string;
  limit: number;
  cursorFilter: SqlParams;
  mergedIntoGuardSql: string;
  libraryScopeSql: string;
  libraryScopeParam?: string;
  extraWhereAfterMatch: string;
}): SqlParams {
  const {
    normalizedQuery,
    prefixPattern,
    ftsQuery,
    limit,
    cursorFilter,
    mergedIntoGuardSql,
    libraryScopeSql,
    libraryScopeParam,
    extraWhereAfterMatch,
  } = options;

  const sql = `SELECT 
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
		WHERE artists_fts MATCH ?
			${mergedIntoGuardSql}${libraryScopeSql}${extraWhereAfterMatch}${cursorFilter.sql}
		ORDER BY relevance_rank, fts_rank, a.name, a.id
		LIMIT ?`;

  const params: unknown[] = [
    normalizedQuery,
    prefixPattern,
    ftsQuery,
    ...(libraryScopeParam ? [libraryScopeParam] : []),
    ...cursorFilter.params,
    limit + 1,
  ];

  return { sql, params };
}
