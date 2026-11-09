/**
 * Global search API endpoint
 * Searches across tracks, albums, artists, and playlists using FTS5 + LIKE
 *
 * Security:
 * - Input validation using Zod schemas (DoS limits)
 * - Literal FTS5 query building (user input never treated as FTS syntax)
 * - Rate limiting handled by Express middleware (1000 req/min for GET)
 * - Playlist search requires authentication (user-scoped). Enforcement lives in
 *   search.server.ts: searchAll() only calls searchPlaylists() when a userId is
 *   present, and searchPlaylists() filters by ownerId = userId. Guests therefore
 *   receive empty playlist results and cannot enumerate other users' playlists.
 *   The loader below only forwards the (optional) userId downstream.
 *
 * Resilience: every JSON body includes `results` + `pagination` so clients
 * never crash on missing fields.
 */

import { type z } from "zod";
import { type SearchResponse } from "#app/types/search.ts";
import { getStaleAuthSessionDestroyCookie, getUserIdOrNull } from "#app/utils/auth.server.ts";
import {
  CursorSchema,
  INVALID_CURSOR_FORMAT_MESSAGE,
  SearchLimitSchema,
  SearchQuerySchema,
  SearchScopeSchema,
  SearchTypeSchema,
} from "#app/utils/search-validation.server.ts";
import { searchWithCache } from "#app/utils/search-cache.server.ts";
import { type Route } from "./+types/search.ts";

function emptySearchResponse(limit: number): SearchResponse {
  return {
    results: [],
    pagination: { limit, hasNext: false, nextCursor: null },
  };
}

function isMalformedSearchQuery(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message === INVALID_CURSOR_FORMAT_MESSAGE ||
      /syntax error|malformed match|fts5/i.test(error.message))
  );
}

function invalidSearchParameters(
  error: z.ZodError,
  json: (body: unknown, init?: ResponseInit) => Response,
  limit = 20,
) {
  return json(
    {
      ...emptySearchResponse(limit),
      error: "Invalid search parameters",
      details: error.issues,
    },
    { status: 400 },
  );
}

export async function loader({ request, url }: Route.LoaderArgs) {
  const userId = await getUserIdOrNull(request);
  const staleCookie = await getStaleAuthSessionDestroyCookie(request, userId);
  const json = (body: unknown, init?: ResponseInit) => {
    if (!staleCookie) return Response.json(body, init);
    const headers = new Headers(init?.headers);
    headers.set("set-cookie", staleCookie);
    return Response.json(body, { ...init, headers });
  };

  const limitParam = url.searchParams.get("limit");
  const limitResult = SearchLimitSchema.safeParse(limitParam ? parseInt(limitParam, 10) : 20);
  const limit = limitResult.success ? limitResult.data : 20;

  const queryResult = SearchQuerySchema.safeParse(url.searchParams.get("q") ?? "");
  if (!queryResult.success) {
    return invalidSearchParameters(queryResult.error, json, limit);
  }

  const typeResult = SearchTypeSchema.safeParse(url.searchParams.get("type") ?? "all");
  if (!typeResult.success) {
    return invalidSearchParameters(typeResult.error, json, limit);
  }

  if (!limitResult.success) {
    return invalidSearchParameters(limitResult.error, json, 20);
  }

  const rawCursor = url.searchParams.get("cursor");
  const cursorResult = CursorSchema.safeParse(rawCursor === null ? undefined : rawCursor);
  if (!cursorResult.success) {
    return invalidSearchParameters(cursorResult.error, json, limit);
  }

  const scopeResult = SearchScopeSchema.safeParse(url.searchParams.get("scope") ?? "all");
  if (!scopeResult.success) {
    return invalidSearchParameters(scopeResult.error, json, limit);
  }

  const usePrefix = url.searchParams.get("prefix") !== "false";

  // Always pass the authenticated userId (Personal Play Boost) and the
  // requested scope separately. searchTracks only applies the UserTrack JOIN
  // when scope === "library"; omitting scope defaults it to "all" and the
  // My Library toggle silently returns the full catalog.
  const userIdForSearch = userId ?? undefined;

  if (scopeResult.data === "library" && !userIdForSearch) {
    return json(
      {
        ...emptySearchResponse(limit),
        error: "Library scope requires authentication",
      },
      { status: 400 },
    );
  }

  try {
    const results = await searchWithCache(
      queryResult.data,
      limitResult.data,
      cursorResult.data,
      typeResult.data,
      usePrefix,
      userIdForSearch,
      scopeResult.data,
    );
    return json(results);
  } catch (error) {
    if (isMalformedSearchQuery(error)) {
      return json(
        {
          ...emptySearchResponse(limitResult.data),
          error: "Invalid search query",
        },
        { status: 400 },
      );
    }
    console.error("🚨 [SEARCH API] Unexpected error searching:", error);
    if (error instanceof Error) {
      console.error("🚨 [SEARCH API] Error stack:", error.stack);
    }
    return json(
      {
        ...emptySearchResponse(limitResult.data),
        error: "Failed to perform search",
      },
      { status: 500 },
    );
  }
}
