import { type QueueTrack } from "#app/types/frontend/shared.ts";
import { prisma } from "#app/utils/db.server.ts";
import { buildLibraryUserTracksWhere } from "#app/utils/library-user-tracks.server.ts";
import { type SortDirection } from "#app/utils/sort-direction.ts";
import { chunkArray } from "#app/utils/chunk-array.ts";
import {
  defaultLibrarySortDirection,
  librarySortToWindow,
  type LibrarySortOption,
} from "#app/features/listening-insights/heavy-rotation.ts";
import { listMostPlayedLibraryPage } from "#app/features/listening-insights/library-tracks.server.ts";
import { LIBRARY_TRACKS_PAGE_SIZE } from "./library-tracks-page-size.ts";
import { QUEUE_TRACK_SELECT } from "./queue-track-select.ts";

/**
 * Full library spine for the audio queue (ADR-015 + ADR-026).
 * Same ordering as the library page for the chosen sort; playable-only by default.
 */
export async function listLibraryQueueSpineTracks({
  userId,
  sort,
  direction = defaultLibrarySortDirection(sort),
  hasAudioOnly = true,
  now = new Date(),
}: {
  userId: string;
  sort: LibrarySortOption;
  direction?: SortDirection;
  hasAudioOnly?: boolean;
  now?: Date;
}): Promise<QueueTrack[]> {
  const where = buildLibraryUserTracksWhere({ userId, hasAudioOnly });
  const window = librarySortToWindow(sort);

  if (!window) {
    const tracks: QueueTrack[] = [];
    let cursor: string | undefined;
    while (true) {
      const page = await prisma.userTrack.findMany({
        where,
        select: {
          id: true,
          track: { select: QUEUE_TRACK_SELECT },
        },
        orderBy: [{ createdAt: direction }, { id: direction }],
        take: LIBRARY_TRACKS_PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      tracks.push(...page.map((userTrack) => userTrack.track));
      if (page.length < LIBRARY_TRACKS_PAGE_SIZE) {
        break;
      }
      cursor = page[page.length - 1]?.id;
    }
    return tracks;
  }

  const orderedUserTrackIds: string[] = [];
  let pageCursor: string | null | undefined = undefined;
  while (true) {
    const page = await listMostPlayedLibraryPage({
      userId,
      window,
      direction,
      hasAudioOnly,
      genreId: null,
      cursor: pageCursor,
      limit: LIBRARY_TRACKS_PAGE_SIZE,
      now,
    });
    orderedUserTrackIds.push(...page.ids);
    if (!page.hasNext) {
      break;
    }
    pageCursor = page.nextCursor;
  }

  if (orderedUserTrackIds.length === 0) {
    return [];
  }

  const trackByUserTrackId = new Map<string, QueueTrack>();
  for (const idChunk of chunkArray(orderedUserTrackIds)) {
    const rows = await prisma.userTrack.findMany({
      where: { id: { in: idChunk } },
      select: {
        id: true,
        track: { select: QUEUE_TRACK_SELECT },
      },
    });
    for (const row of rows) {
      trackByUserTrackId.set(row.id, row.track);
    }
  }

  return orderedUserTrackIds
    .map((id) => trackByUserTrackId.get(id))
    .filter((track): track is QueueTrack => Boolean(track));
}
