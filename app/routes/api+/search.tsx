/**
 * Global search API endpoint
 * Searches across tracks, albums, artists, and playlists using FTS5 + LIKE
 *
 * Security:
 * - Input validation using Zod schemas (DoS limits)
 * - Literal FTS5 query building (user input never treated as FTS syntax)
 * - Rate limiting handled by Express middleware (1000 req/min for GET)
 * - Playlist search requires authentication (user-scoped)
 *
 * Resilience: every JSON body includes `results` + `pagination` so clients
 * never crash on missing fields.
 */

import { type z } from "zod";
import { type SearchResponse } from "#app/types/search.ts";
import { getUserId } from "#app/utils/auth.server.ts";
import {
  CursorSchema,
  SearchLimitSchema,
  SearchQuerySchema,
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

function invalidSearchParameters(error: z.ZodError, limit = 20) {
  return Response.json(
    {
      ...emptySearchResponse(limit),
      error: "Invalid search parameters",
      details: error.issues,
    },
    { status: 400 },
  );
}

export async function loader({ request, url }: Route.LoaderArgs) {
  const limitParam = url.searchParams.get("limit");
  const limitResult = SearchLimitSchema.safeParse(limitParam ? parseInt(limitParam, 10) : 20);
  const limit = limitResult.success ? limitResult.data : 20;

  const queryResult = SearchQuerySchema.safeParse(url.searchParams.get("q") ?? "");
  if (!queryResult.success) {
    return invalidSearchParameters(queryResult.error, limit);
  }

  const typeResult = SearchTypeSchema.safeParse(url.searchParams.get("type") ?? "all");
  if (!typeResult.success) {
    return invalidSearchParameters(typeResult.error, limit);
  }

  if (!limitResult.success) {
    return invalidSearchParameters(limitResult.error, 20);
  }

  const rawCursor = url.searchParams.get("cursor");
  const cursorResult = CursorSchema.safeParse(rawCursor === null ? undefined : rawCursor);
  if (!cursorResult.success) {
    return invalidSearchParameters(cursorResult.error, limit);
  }

  const usePrefix = url.searchParams.get("prefix") !== "false";

  // Get the authenticated user ID if available (needed for playlist search)
  const userId = (await getUserId(request)) ?? undefined;

  try {
    const results = await searchWithCache(
      queryResult.data,
      limitResult.data,
      cursorResult.data,
      typeResult.data,
      usePrefix,
      userId,
    );
    return Response.json(results);
  } catch (error) {
    console.error("🚨 [SEARCH API] Unexpected error searching:", error);
    if (error instanceof Error) {
      console.error("🚨 [SEARCH API] Error stack:", error.stack);
    }
    return Response.json(
      {
        ...emptySearchResponse(limitResult.data),
        error: "Failed to perform search",
      },
      { status: 500 },
    );
  }
}
