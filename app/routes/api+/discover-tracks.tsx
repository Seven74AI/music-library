import { requireUserId } from "#app/utils/auth.server.ts";
import {
  DISCOVER_TRACKS_PAGE_SIZE,
  defaultDiscoverSortDirection,
  listDiscoverTracks,
  parseDiscoverSort,
} from "#app/utils/discover-tracks.server.ts";
import { parseSortDirection } from "#app/utils/sort-direction.ts";

export async function loader({ request, url }: { request: Request; url: URL }) {
  try {
    const userId = await requireUserId(request);

    const cursor = url.searchParams.get("cursor");
    const limitParam = url.searchParams.get("limit");
    const limit = parseInt(limitParam || String(DISCOVER_TRACKS_PAGE_SIZE));
    const sort = parseDiscoverSort(url.searchParams.get("sort"));
    const direction = parseSortDirection(
      url.searchParams.get("dir"),
      defaultDiscoverSortDirection(sort),
    );

    if (isNaN(limit) || limit < 1 || limit > 100) {
      return Response.json({ error: "Invalid limit parameter" }, { status: 400 });
    }

    const { tracks, pagination } = await listDiscoverTracks({
      userId,
      sort,
      direction,
      cursor,
      limit,
    });

    return Response.json({
      tracks,
      pagination,
    });
  } catch (error) {
    console.error("Error fetching discover tracks:", error);
    return Response.json({ error: "Failed to fetch tracks" }, { status: 500 });
  }
}
