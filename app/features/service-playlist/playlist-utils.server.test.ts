import { describe, expect, test, vi, beforeEach } from "vitest";
import { SQLITE_IN_CHUNK_SIZE } from "#app/utils/chunk-array.ts";
import { prisma } from "#app/utils/db.server";
import { getActiveSyncedPlaylistTrackIds } from "./playlist-utils.server";

vi.mock("#app/utils/db.server", () => ({
  prisma: {
    service: {
      findUnique: vi.fn(),
    },
    servicePlaylist: {
      findMany: vi.fn(),
    },
    servicePlaylistTrack: {
      findMany: vi.fn(),
    },
  },
}));

describe("getActiveSyncedPlaylistTrackIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.service.findUnique).mockResolvedValue({
      id: "svc-1",
      name: "youtube",
    } as never);
  });

  test("chunks playlistId IN queries when many synced playlists exist", async () => {
    const playlistIds = Array.from(
      { length: SQLITE_IN_CHUNK_SIZE + 3 },
      (_, i) => `pl-${i}`,
    );
    vi.mocked(prisma.servicePlaylist.findMany).mockResolvedValue(
      playlistIds.map((id) => ({ id })) as never,
    );
    vi.mocked(prisma.servicePlaylistTrack.findMany).mockImplementation(
      (args) => {
        const where = args?.where as
          { playlistId?: { in?: string[] } } | undefined;
        const chunk = where?.playlistId?.in ?? [];
        return Promise.resolve(
          chunk.map((playlistId, index) => ({
            trackId: `track-${playlistId}-${index}`,
          })),
        ) as ReturnType<typeof prisma.servicePlaylistTrack.findMany>;
      },
    );

    const result = await getActiveSyncedPlaylistTrackIds("user-1");

    expect(prisma.servicePlaylistTrack.findMany).toHaveBeenCalledTimes(2);
    expect(result.playlistIds).toHaveLength(SQLITE_IN_CHUNK_SIZE + 3);
    expect(result.trackIds.length).toBeGreaterThan(0);
  });
});
