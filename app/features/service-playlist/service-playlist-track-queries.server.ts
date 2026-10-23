import { type Prisma } from "#prisma/client.js";

/**
 * Page size for ServicePlaylistTrack findMany calls that use nested includes.
 * Prisma loads relations with `WHERE id IN (...)` — keep each page under SQLite's 999 bind-param limit.
 */
export const SERVICE_PLAYLIST_TRACK_PAGE_SIZE = 200;

type ServicePlaylistTrackFindManyClient = {
  servicePlaylistTrack: {
    findMany: (args: Prisma.ServicePlaylistTrackFindManyArgs) => Promise<unknown[]>;
  };
};

type FindManyArgsWithoutPagination = Omit<
  Prisma.ServicePlaylistTrackFindManyArgs,
  "take" | "skip" | "cursor" | "orderBy"
>;

export async function findAllServicePlaylistTracks<T extends FindManyArgsWithoutPagination>(
  client: ServicePlaylistTrackFindManyClient,
  args: T,
): Promise<Prisma.ServicePlaylistTrackGetPayload<T & { orderBy: { id: "asc" } }>[]> {
  const results: Prisma.ServicePlaylistTrackGetPayload<T & { orderBy: { id: "asc" } }>[] = [];
  let cursor: string | undefined;

  while (true) {
    const page = (await client.servicePlaylistTrack.findMany({
      ...args,
      orderBy: { id: "asc" },
      take: SERVICE_PLAYLIST_TRACK_PAGE_SIZE,
      // Cursor pagination: skip the cursor row itself (Prisma's cursor is
      // inclusive) and resume from the last id of the previous page. Stable
      // under concurrent inserts unlike `skip` offset, which is O(n²) and can
      // skip/duplicate rows when the set mutates mid-iteration.
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })) as Prisma.ServicePlaylistTrackGetPayload<T & { orderBy: { id: "asc" } }>[];

    results.push(...page);
    if (page.length < SERVICE_PLAYLIST_TRACK_PAGE_SIZE) {
      break;
    }
    cursor = page[page.length - 1]?.id;
  }

  return results;
}
