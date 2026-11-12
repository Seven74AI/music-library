import { type QueueTrack } from "#app/types/frontend/shared.ts";
import { prisma } from "#app/utils/db.server.ts";
import { buildLibraryUserTracksWhere } from "#app/utils/library-user-tracks.server.ts";
import { type SortDirection } from "#app/utils/sort-direction.ts";
import {
  defaultLibrarySortDirection,
  librarySortToWindow,
  sortByPlayCompletedCount,
  type LibrarySortOption,
} from "#app/features/listening-insights/heavy-rotation.ts";
import { getPlayCompletedCountsByTrack } from "#app/features/listening-insights/play-completed-counts.server.ts";
import { QUEUE_TRACK_SELECT } from "./queue-track-select.ts";

/**
 * Full library spine for the audio queue (ADR-015 + ADR-026).
 * Same ordering as the library page for the chosen sort; playable-only by default.
 * Single fetch by design (ADR-015 rejected pagination): do not loop/paginate here.
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
    const userTracks = await prisma.userTrack.findMany({
      where,
      select: { track: { select: QUEUE_TRACK_SELECT } },
      orderBy: [{ createdAt: direction }, { id: direction }],
    });
    return userTracks.map((userTrack) => userTrack.track);
  }

  const counts = await getPlayCompletedCountsByTrack({ userId, window, now });
  const sortable = await prisma.userTrack.findMany({
    where,
    select: {
      id: true,
      trackId: true,
      createdAt: true,
      track: { select: QUEUE_TRACK_SELECT },
    },
  });

  return sortByPlayCompletedCount(sortable, counts, direction).map((row) => row.track);
}
