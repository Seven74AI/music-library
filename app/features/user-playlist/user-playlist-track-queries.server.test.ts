import { describe, expect, test, vi, beforeEach } from "vitest";
import {
  findAllUserPlaylistTracks,
  USER_PLAYLIST_TRACK_PAGE_SIZE,
} from "./user-playlist-track-queries.server.ts";

describe("findAllUserPlaylistTracks", () => {
  const findMany = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns a single page when results fit in one query", async () => {
    findMany.mockResolvedValueOnce([
      { id: "upt-1", position: 1 },
      { id: "upt-2", position: 2 },
    ]);

    const client = { userPlaylistTrack: { findMany } };
    const results = await findAllUserPlaylistTracks(client, {
      where: { playlistId: "playlist-1" },
    });

    expect(results).toHaveLength(2);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { playlistId: "playlist-1" },
        take: USER_PLAYLIST_TRACK_PAGE_SIZE,
        orderBy: [{ position: "asc" }, { id: "asc" }],
      }),
    );
  });

  test("paginates until a partial page is returned", async () => {
    const firstPage = Array.from({ length: USER_PLAYLIST_TRACK_PAGE_SIZE }, (_, i) => ({
      id: `upt-${i}`,
      position: i + 1,
    }));
    const secondPage = [{ id: "upt-last", position: USER_PLAYLIST_TRACK_PAGE_SIZE + 1 }];

    findMany.mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage);

    const client = { userPlaylistTrack: { findMany } };
    const results = await findAllUserPlaylistTracks(client, {
      where: { playlistId: "playlist-1" },
      select: { id: true, position: true },
    });

    expect(results).toHaveLength(USER_PLAYLIST_TRACK_PAGE_SIZE + 1);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[1]?.[0]).toMatchObject({
      skip: 1,
      cursor: { id: `upt-${USER_PLAYLIST_TRACK_PAGE_SIZE - 1}` },
    });
  });
});
