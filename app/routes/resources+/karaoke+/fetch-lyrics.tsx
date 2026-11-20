import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { lookupLyrics } from "#app/utils/lyrics-lookup.server.ts";
import { makeRateLimiter } from "#app/utils/rate-limit.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/fetch-lyrics.ts";

export const FetchLyricsSchema = z.object({ trackId: z.string().min(1) });

const LYRICS_FETCHES_PER_MINUTE = 10;

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

export async function action({ request }: ActionFunctionArgs) {
  const userId = await requireUserId(request);

  // Per-user throttle lives here (lookupLyrics stays user-agnostic); the 5-min result cache
  // lives inside lookupLyrics.
  const budget = makeRateLimiter("karaoke-fetch-lyrics", LYRICS_FETCHES_PER_MINUTE).consume(
    userId,
  );
  if (!budget.allowed) {
    return data(
      {
        success: false,
        error: "Too many lyrics lookups. Please try again shortly.",
        retryAfterSeconds: budget.retryAfterSeconds,
      },
      { status: 429 },
    );
  }

  const parsed = FetchLyricsSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) {
    return data({ success: false, error: "trackId is required" }, { status: 400 });
  }
  const track = await prisma.track.findUnique({
    where: { id: parsed.data.trackId },
    select: { title: true, artist: { select: { name: true } } },
  });
  if (!track) return data({ success: false, error: "Track not found" }, { status: 404 });

  const result = await lookupLyrics({ title: track.title, artist: track.artist.name });
  if (!result.ok) {
    return data(
      { success: false, error: result.error, kind: result.kind },
      { status: result.kind === "not-found" ? 404 : 502 },
    );
  }
  return data({ success: true, lyrics: result.lyrics });
}
