import { getUserId } from "#app/utils/auth.server.ts";
import {
  ARTIST_TRACK_PAGE_SIZE,
  getArtistTracksPage,
} from "#app/features/artist/artist-tracks.server.ts";

export async function loader({ request, url }: { request: Request; url: URL }) {
  const artistId = url.searchParams.get("artistId");
  if (!artistId) {
    return Response.json({ error: "Artist ID is required" }, { status: 400 });
  }

  const rawLimit = url.searchParams.get("limit");
  let limit = ARTIST_TRACK_PAGE_SIZE;
  if (rawLimit !== null) {
    const parsed = Number.parseInt(rawLimit, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      return Response.json({ error: "Invalid limit parameter" }, { status: 400 });
    }
    limit = parsed;
  }

  const userId = await getUserId(request);
  const cursor = url.searchParams.get("cursor") ?? undefined;

  const result = await getArtistTracksPage(userId, artistId, { limit, cursor });
  return Response.json(result);
}
