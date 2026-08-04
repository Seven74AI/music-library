import { describe, expect, test, vi, beforeEach } from "vitest";
import { loadLibraryStatusByTrackId, loadUserPlaylists } from "./track-list-loader.server.ts";

vi.mock("#app/utils/db.server.ts", () => ({
  prisma: {
    userPlaylist: {
      findMany: vi.fn(),
    },
    userTrack: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "#app/utils/db.server.ts";

describe("track-list-loader.server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("loadUserPlaylists returns empty array when user is not signed in", async () => {
    await expect(loadUserPlaylists(null)).resolves.toEqual([]);
    expect(prisma.userPlaylist.findMany).not.toHaveBeenCalled();
  });

  test("loadLibraryStatusByTrackId returns empty maps when user is not signed in", async () => {
    const result = await loadLibraryStatusByTrackId(null, ["track-1"]);
    expect(result.libraryTrackIds.size).toBe(0);
    expect(result.userTrackCreatedAtByTrackId.size).toBe(0);
    expect(prisma.userTrack.findMany).not.toHaveBeenCalled();
  });

  test("loadLibraryStatusByTrackId maps user tracks by track id", async () => {
    const createdAt = new Date("2024-01-01T00:00:00.000Z");
    vi.mocked(prisma.userTrack.findMany).mockResolvedValue([
      { trackId: "track-1", createdAt },
    ] as never);

    const result = await loadLibraryStatusByTrackId("user-1", ["track-1", "track-2"]);

    expect(result.libraryTrackIds.has("track-1")).toBe(true);
    expect(result.libraryTrackIds.has("track-2")).toBe(false);
    expect(result.userTrackCreatedAtByTrackId.get("track-1")).toEqual(createdAt);
  });
});
