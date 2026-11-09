import { type Prisma } from "#prisma/client.js";
import { SERVICE_PLAYLIST_TRACK_PAGE_SIZE } from "#app/features/service-playlist/service-playlist-track-queries.server.ts";

/**
 * Page size for UserPlaylistTrack findMany calls that use nested includes.
 * Prisma loads relations with `WHERE id IN (...)` — keep each page under SQLite's 999 bind-param limit.
 */
export const USER_PLAYLIST_TRACK_PAGE_SIZE = SERVICE_PLAYLIST_TRACK_PAGE_SIZE;

type UserPlaylistTrackFindManyClient = {
  userPlaylistTrack: {
    findMany: (args: Prisma.UserPlaylistTrackFindManyArgs) => Promise<unknown[]>;
  };
};

type FindManyArgsWithoutPagination = Omit<
  Prisma.UserPlaylistTrackFindManyArgs,
  "take" | "skip" | "cursor" | "orderBy"
>;

const USER_PLAYLIST_TRACK_ORDER = [{ position: "asc" as const }, { id: "asc" as const }];

export async function findAllUserPlaylistTracks<T extends FindManyArgsWithoutPagination>(
  client: UserPlaylistTrackFindManyClient,
  args: T,
): Promise<
  Prisma.UserPlaylistTrackGetPayload<T & { orderBy: typeof USER_PLAYLIST_TRACK_ORDER }>[]
> {
  const results: Prisma.UserPlaylistTrackGetPayload<
    T & { orderBy: typeof USER_PLAYLIST_TRACK_ORDER }
  >[] = [];
  let cursor: string | undefined;

  while (true) {
    const page = (await client.userPlaylistTrack.findMany({
      ...args,
      orderBy: USER_PLAYLIST_TRACK_ORDER,
      take: USER_PLAYLIST_TRACK_PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })) as Prisma.UserPlaylistTrackGetPayload<T & { orderBy: typeof USER_PLAYLIST_TRACK_ORDER }>[];

    results.push(...page);
    if (page.length < USER_PLAYLIST_TRACK_PAGE_SIZE) {
      break;
    }
    cursor = page[page.length - 1]?.id;
  }

  return results;
}
