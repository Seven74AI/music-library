import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/fetch-lyrics.ts";

export const FetchLyricsSchema = z.object({ trackId: z.string().min(1) });

export const MOCK_FETCHED_LYRICS = "Mock line one\nMock line two\nMock line three";

/** What a lyrics provider is given. The endpoint is server-fixed, never user-supplied. */
export type LyricsLookup = { title: string; artist: string };

/**
 * Lyrics provider seam. The real AZLyrics/Genius scraper is DEFERRED (follow-up
 * must use server-fixed endpoints + an SSRF guard). Until then non-MOCKS mode
 * reports "not available".
 */
async function lookupLyrics(
  _lookup: LyricsLookup,
): Promise<{ ok: true; lyrics: string } | { ok: false; error: string }> {
  if (process.env.MOCKS === "true") return { ok: true, lyrics: MOCK_FETCHED_LYRICS };
  return { ok: false, error: "Lyrics fetch is not available yet" };
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

export async function action({ request }: ActionFunctionArgs) {
  await requireUserId(request);
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
  if (!result.ok) return data({ success: false, error: result.error }, { status: 501 });
  return data({ success: true, lyrics: result.lyrics });
}
