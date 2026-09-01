import { prisma } from "#app/utils/db.server.ts";
import { loadLibraryStatusByTrackId } from "#app/utils/track-list-loader.server.ts";

export const ARTIST_TRACK_PAGE_SIZE = 50;

const ARTIST_TRACK_SELECT = {
  id: true,
  title: true,
  duration: true,
  createdAt: true,
  serviceUrl: true,
  albumRecord: {
    select: { id: true, name: true },
  },
  coverImage: {
    select: { objectKey: true },
  },
  service: {
    select: {
      displayName: true,
      logoUrl: true,
    },
  },
  audioFiles: {
    select: { id: true, format: true, objectKey: true },
  },
} as const;

export interface ArtistTracksPage {
  tracks: Array<{
    id: string;
    title: string;
    duration: number | null;
    createdAt: Date;
    serviceUrl: string | null;
    albumRecord: { id: string; name: string } | null;
    coverImage: { objectKey: string } | null;
    service: { displayName: string; logoUrl: string | null } | null;
    audioFiles: Array<{ id: string; format: string | null; objectKey: string }>;
    isInUserLibrary: boolean;
    userTrackCreatedAt: string;
  }>;
  pagination: { limit: number; hasNext: boolean; nextCursor: string | null };
}

/**
 * Cursor-paginated tracks for a single artist, ordered `createdAt desc` with an
 * `id desc` tiebreaker so keyset pagination stays deterministic when tracks
 * share a `createdAt` (matches the playlists index loader pattern).
 *
 * `userId` may be null (guests can browse artist pages) — library status is
 * resolved to empty sets in that case.
 */
export async function getArtistTracksPage(
  userId: string | null,
  artistId: string,
  { limit = ARTIST_TRACK_PAGE_SIZE, cursor }: { limit?: number; cursor?: string } = {},
): Promise<ArtistTracksPage> {
  // Fetch one extra row to know whether another page exists without a second query.
  const tracksRaw = await prisma.track.findMany({
    where: { artistId },
    select: ARTIST_TRACK_SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    cursor: cursor ? { id: cursor } : undefined,
    skip: cursor ? 1 : undefined,
  });

  const hasNext = tracksRaw.length > limit;
  const page = hasNext ? tracksRaw.slice(0, limit) : tracksRaw;
  const nextCursor = hasNext ? (page[page.length - 1]?.id ?? null) : null;

  const trackIds = page.map((track) => track.id);
  const { libraryTrackIds, userTrackCreatedAtByTrackId } = await loadLibraryStatusByTrackId(
    userId,
    trackIds,
  );

  const tracks = page.map((track) => ({
    ...track,
    isInUserLibrary: libraryTrackIds.has(track.id),
    userTrackCreatedAt:
      userTrackCreatedAtByTrackId.get(track.id)?.toISOString() ?? track.createdAt.toISOString(),
  }));

  return {
    tracks,
    pagination: { limit, hasNext, nextCursor },
  };
}
