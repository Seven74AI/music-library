import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "#app/utils/db.server";
import { createUser } from "#tests/db-utils";
import { noopArchiveEnqueueAdapter } from "./archive-enqueue-adapter.server";
import { createServicePlaylistService } from "./service-playlist.server";

const {
  mockGetPlaylist,
  mockGetPlaylistItems,
  mockCheckVideosExist,
  mockResolveToken,
} = vi.hoisted(() => ({
  mockGetPlaylist: vi.fn(),
  mockGetPlaylistItems: vi.fn(),
  mockCheckVideosExist: vi.fn(),
  mockResolveToken: vi.fn(),
}));

vi.mock("#app/features/service-connection/service-connection.server", () => ({
  resolveServiceAccessToken: mockResolveToken,
}));

vi.mock("#app/utils/youtube.server", () => ({
  createYouTubeService: vi.fn(() => ({
    getPlaylist: mockGetPlaylist,
    getPlaylistItems: mockGetPlaylistItems,
    checkVideosExist: mockCheckVideosExist,
  })),
}));

const ytItem = (id: string, videoId: string) => ({
  id,
  snippet: {
    title: `Title ${videoId}`,
    resourceId: { videoId },
    videoOwnerChannelTitle: "Uploader",
  },
});

describe("syncServicePlaylist with duplicate videos", () => {
  let userId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    await prisma.servicePlaylistTrack.deleteMany();
    await prisma.servicePlaylist.deleteMany();
    await prisma.connection.deleteMany();
    await prisma.user.deleteMany();
    userId = (await prisma.user.create({ data: createUser() })).id;
    mockResolveToken.mockResolvedValue({ access_token: "token" });
    mockGetPlaylist.mockResolvedValue({
      id: "PLdupes",
      snippet: {
        title: "Dupes",
        channelId: "c",
        channelTitle: "C",
        thumbnails: {},
      },
      contentDetails: { itemCount: 0 },
    });
    mockCheckVideosExist.mockResolvedValue(new Set<string>());
  });

  test("removing one of two copies deletes the surplus row without reporting a removal", async () => {
    const service = createServicePlaylistService({
      archiveEnqueueAdapter: noopArchiveEnqueueAdapter,
    });
    mockGetPlaylistItems.mockResolvedValue([
      ytItem("pi-1", "vid-a"),
      ytItem("pi-2", "vid-a"),
    ]);
    const first = await service.syncServicePlaylist(
      "youtube",
      "PLdupes",
      userId,
    );
    expect(await prisma.servicePlaylistTrack.count()).toBe(2);

    mockGetPlaylistItems.mockResolvedValue([ytItem("pi-2", "vid-a")]);
    // Re-sync via the internal id → resyncExistingPlaylist, where deleteMany runs.
    const result = await service.syncServicePlaylist(
      "youtube",
      first.playlistId!,
      userId,
    );

    expect(result.success).toBe(true);
    const rows = await prisma.servicePlaylistTrack.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.playlistItemId).toBe("pi-2");
    // The video is still in the playlist, so the UI must not report it as removed.
    expect(result.removedTracks).toHaveLength(0);
  });

  test("a duplicated playlistItem.id in the fetched payload does not fail the sync", async () => {
    const service = createServicePlaylistService({
      archiveEnqueueAdapter: noopArchiveEnqueueAdapter,
    });
    mockGetPlaylistItems.mockResolvedValue([
      ytItem("pi-1", "vid-a"),
      ytItem("pi-1", "vid-a"),
    ]);
    const result = await service.syncServicePlaylist(
      "youtube",
      "PLdupes",
      userId,
    );
    expect(result.success).toBe(true);
    expect(await prisma.servicePlaylistTrack.count()).toBe(1);
  });
});
