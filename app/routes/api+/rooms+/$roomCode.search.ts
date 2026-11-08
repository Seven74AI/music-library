/**
 * Participant-gated Party Room catalog search (has-audio only).
 */

import { z } from "zod";
import { canAddTracks } from "#app/features/party-room/capabilities.ts";
import {
  resolveRoomParticipantByCode,
  touchParticipant,
} from "#app/features/party-room/participant-seat.server.ts";
import { roomSearchRateLimit } from "#app/features/party-room/rate-limit.server.ts";
import {
  searchRoomCatalog,
  type RoomSearchType,
} from "#app/features/party-room/room-search.server.ts";
import {
  CursorSchema,
  INVALID_CURSOR_FORMAT_MESSAGE,
  SearchLimitSchema,
  SearchQuerySchema,
} from "#app/utils/search-validation.server.ts";

const TypeSchema = z.enum(["all", "tracks", "albums", "artists"]);

function empty(limit: number) {
  return {
    results: [] as unknown[],
    pagination: { limit, hasNext: false, nextCursor: null as string | null },
  };
}

function isMalformedSearchQuery(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message === INVALID_CURSOR_FORMAT_MESSAGE ||
      /syntax error|malformed match|fts5/i.test(error.message))
  );
}

export async function loader({
  request,
  params,
}: {
  request: Request;
  params: { roomCode?: string };
}) {
  const url = new URL(request.url);
  const code = params.roomCode?.toUpperCase();
  const limitParam = url.searchParams.get("limit");
  const limitResult = SearchLimitSchema.safeParse(limitParam ? parseInt(limitParam, 10) : 20);
  const limit = limitResult.success ? limitResult.data : 20;

  if (!code) {
    return Response.json({ error: "Room code required", ...empty(limit) }, { status: 400 });
  }

  const participant = await resolveRoomParticipantByCode(request, code);
  if (!participant || participant.roomStatus !== "open") {
    return Response.json(
      { error: "Valid room participant seat required", code: "unauthorized", ...empty(limit) },
      { status: 401 },
    );
  }

  const queryResult = SearchQuerySchema.safeParse(url.searchParams.get("q") ?? "");
  if (!queryResult.success) {
    return Response.json({ error: "Invalid search query", ...empty(limit) }, { status: 400 });
  }

  const typeResult = TypeSchema.safeParse(url.searchParams.get("type") ?? "all");
  if (!typeResult.success) {
    return Response.json({ error: "Invalid type", ...empty(limit) }, { status: 400 });
  }

  const cursorResult = CursorSchema.safeParse(
    url.searchParams.get("cursor") === null ? undefined : url.searchParams.get("cursor"),
  );
  if (!cursorResult.success) {
    return Response.json({ error: "Invalid cursor", ...empty(limit) }, { status: 400 });
  }

  const budget = roomSearchRateLimit.consume(participant.id);
  if (!budget.allowed) {
    return Response.json(
      { error: "rate_limited", code: "rate_limited", ...empty(limit) },
      { status: 429, headers: { "Retry-After": String(budget.retryAfterSeconds) } },
    );
  }

  await touchParticipant(participant.id);

  try {
    const results = await searchRoomCatalog({
      query: queryResult.data,
      limit,
      cursor: cursorResult.data,
      type: typeResult.data as RoomSearchType,
    });

    return Response.json({
      ...results,
      meta: {
        participantId: participant.id,
        role: participant.role,
        canAddTracks: canAddTracks(participant.role),
        hasAudioOnly: true,
      },
    });
  } catch (error) {
    if (isMalformedSearchQuery(error)) {
      return Response.json({ error: "Invalid search query", ...empty(limit) }, { status: 400 });
    }
    console.error("[ROOM SEARCH API] Unexpected error searching:", error);
    if (error instanceof Error) {
      console.error("[ROOM SEARCH API] Error stack:", error.stack);
    }
    return Response.json({ error: "Failed to perform search", ...empty(limit) }, { status: 500 });
  }
}
