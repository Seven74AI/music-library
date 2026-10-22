import { describe, expect, test, vi, beforeEach } from "vitest";
import { consoleError } from "#tests/setup/setup-test-env.ts";
import { addTracksToUserLibrary } from "#app/features/user-library/user-library.server";
import { getActiveSyncedPlaylistTrackIds } from "#app/features/service-playlist/playlist-utils.server";
import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { action } from "./add-all-service-tracks-to-library.tsx";

vi.mock("#app/utils/auth.server.ts", () => ({
  requireUserId: vi.fn(),
}));

vi.mock("#app/features/service-playlist/playlist-utils.server", () => ({
  getActiveSyncedPlaylistTrackIds: vi.fn(),
}));

vi.mock("#app/features/user-library/user-library.server", () => ({
  addTracksToUserLibrary: vi.fn(),
}));

vi.mock("#app/utils/db.server.ts", () => ({
  prisma: {
    userTrack: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("#app/utils/toast.server.ts", () => ({
  createToastHeaders: vi.fn().mockResolvedValue({}),
}));

function makeRequest() {
  return new Request("http://localhost/resources/add-all-service-tracks-to-library", {
    method: "POST",
  });
}

describe("add-all-service-tracks-to-library action", () => {
  beforeEach(() => {
    consoleError.mockImplementation(() => {});
    vi.clearAllMocks();
    vi.mocked(requireUserId).mockResolvedValue("user-1");
  });

  test("returns 400 when user has no synced playlists", async () => {
    vi.mocked(getActiveSyncedPlaylistTrackIds).mockResolvedValue({
      playlistIds: [],
      trackIds: [],
    });

    const response = await action({
      request: makeRequest(),
    } as never);

    expect(response).toMatchObject({
      data: { status: "error", message: "No synced playlists found" },
    });
  });

  test("returns success when no tracks exist across playlists", async () => {
    vi.mocked(getActiveSyncedPlaylistTrackIds).mockResolvedValue({
      playlistIds: ["pl-1"],
      trackIds: [],
    });

    const response = await action({
      request: makeRequest(),
    } as never);

    expect(response).toMatchObject({
      data: { status: "success", addedCount: 0 },
    });
  });

  test("returns success when all tracks are already in library", async () => {
    vi.mocked(getActiveSyncedPlaylistTrackIds).mockResolvedValue({
      playlistIds: ["pl-1"],
      trackIds: ["track-1", "track-2"],
    });

    vi.mocked(prisma.userTrack.findMany).mockResolvedValue([
      { trackId: "track-1" },
      { trackId: "track-2" },
    ] as any);

    const response = await action({
      request: makeRequest(),
    } as never);

    expect(response).toMatchObject({
      data: { status: "success", addedCount: 0 },
    });
    expect(response.data.message).toContain("already in your library");
  });

  test("bulk adds missing tracks and returns count", async () => {
    vi.mocked(getActiveSyncedPlaylistTrackIds).mockResolvedValue({
      playlistIds: ["pl-1", "pl-2"],
      trackIds: ["track-1", "track-2", "track-3"],
    });

    vi.mocked(prisma.userTrack.findMany).mockResolvedValue([{ trackId: "track-1" }] as any);

    vi.mocked(addTracksToUserLibrary).mockResolvedValue({
      success: true,
      message: "2 tracks added to library",
      addedCount: 2,
    });

    const response = await action({
      request: makeRequest(),
    } as never);

    expect(addTracksToUserLibrary).toHaveBeenCalledWith(["track-2", "track-3"], "user-1");
    expect(response).toMatchObject({
      data: { status: "success", addedCount: 2 },
    });
  });

  test("returns 500 when bulk add fails", async () => {
    vi.mocked(getActiveSyncedPlaylistTrackIds).mockResolvedValue({
      playlistIds: ["pl-1"],
      trackIds: ["track-1"],
    });

    vi.mocked(prisma.userTrack.findMany).mockResolvedValue([]);
    vi.mocked(addTracksToUserLibrary).mockResolvedValue({
      success: false,
      message: "Database error",
      addedCount: 0,
    });

    const response = await action({
      request: makeRequest(),
    } as never);

    expect(response).toMatchObject({
      data: { status: "error" },
    });
  });

  test("catches unexpected errors and returns 500", async () => {
    vi.mocked(getActiveSyncedPlaylistTrackIds).mockRejectedValue(new Error("DB connection lost"));

    const response = await action({
      request: makeRequest(),
    } as never);

    expect(response).toMatchObject({
      data: { status: "error", message: "Internal server error" },
    });
  });

  test("chunks the existing-library check across the SQLite bind limit", async () => {
    const manyTrackIds = Array.from({ length: 1200 }, (_, i) => `track-${i}`);
    vi.mocked(getActiveSyncedPlaylistTrackIds).mockResolvedValue({
      playlistIds: ["pl-1"],
      trackIds: manyTrackIds,
    });

    // No tracks already in library: every source track is missing
    vi.mocked(prisma.userTrack.findMany).mockResolvedValue([] as any);
    vi.mocked(addTracksToUserLibrary).mockResolvedValue({
      success: true,
      message: "1200 tracks added to library",
      addedCount: 1200,
    });

    const response = await action({
      request: makeRequest(),
    } as never);

    expect(response).toMatchObject({
      data: { status: "success", addedCount: 1200 },
    });

    // ceil(1200 / 500) = 3 findMany calls, each chunk <= 500
    const findManyMock = vi.mocked(prisma.userTrack.findMany);
    expect(findManyMock).toHaveBeenCalledTimes(3);
    const chunkSizes = findManyMock.mock.calls.map(
      (call) => (call[0] as any).where.trackId.in.length,
    );
    expect(chunkSizes).toEqual([500, 500, 200]);
    expect(addTracksToUserLibrary).toHaveBeenCalledTimes(1);
    const missingIds = vi.mocked(addTracksToUserLibrary).mock.calls[0]![0] as string[];
    expect(missingIds).toHaveLength(1200);
    expect(addTracksToUserLibrary).toHaveBeenCalledWith(missingIds, "user-1");
  });
});
