import { describe, expect, test, vi, beforeEach } from "vitest";
import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { bumpUserPlaylistUpdatedAt } from "#app/utils/user-playlist.server.ts";
import { action } from "./playlists.$playlistId.tsx";

vi.mock("#app/utils/auth.server.ts", () => ({
  requireUserId: vi.fn(),
}));

vi.mock("#app/utils/db.server.ts", () => ({
  prisma: {
    userPlaylist: {
      update: vi.fn(),
    },
    userPlaylistTrack: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("#app/utils/user-playlist.server.ts", () => ({
  bumpUserPlaylistUpdatedAt: vi.fn(),
  userPlaylistTitleTaken: vi.fn(),
}));

vi.mock("#app/utils/toast.server.ts", () => ({
  createToastHeaders: vi.fn().mockResolvedValue({}),
}));

function makeRequest(formData: FormData) {
  return new Request("http://localhost/playlists/playlist-1", {
    method: "POST",
    body: formData,
  });
}

function callAction(formData: FormData) {
  return action({
    request: makeRequest(formData),
    params: { playlistId: "playlist-1" },
  } as never);
}

describe("playlists.$playlistId action — updatedAt bump", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUserId).mockResolvedValue("user-1");
  });

  describe("reorder", () => {
    test("bumps playlist updatedAt after reordering tracks", async () => {
      vi.mocked(prisma.$transaction).mockResolvedValue([] as never);

      const fd = new FormData();
      fd.append("intent", "reorder");
      fd.append(
        "trackOrder",
        JSON.stringify([
          { id: "pt-1", position: 0 },
          { id: "pt-2", position: 1 },
        ]),
      );

      const response = await callAction(fd);

      expect(response).toMatchObject({
        data: { success: true },
      });
      expect(bumpUserPlaylistUpdatedAt).toHaveBeenCalledWith({
        playlistId: "playlist-1",
        userId: "user-1",
      });
    });
  });

  describe("remove-track", () => {
    test("bumps playlist updatedAt after removing a track", async () => {
      vi.mocked(prisma.userPlaylistTrack.findFirst).mockResolvedValue({
        id: "pt-1",
      } as never);
      vi.mocked(prisma.userPlaylistTrack.delete).mockResolvedValue({} as never);

      const fd = new FormData();
      fd.append("intent", "remove-track");
      fd.append("trackId", "pt-1");

      const response = await callAction(fd);

      expect(response).toMatchObject({
        data: { success: true },
      });
      expect(bumpUserPlaylistUpdatedAt).toHaveBeenCalledWith({
        playlistId: "playlist-1",
        userId: "user-1",
      });
    });
  });

  describe("bulk-remove-tracks", () => {
    test("bumps playlist updatedAt after bulk-removing tracks", async () => {
      vi.mocked(prisma.userPlaylistTrack.findMany).mockResolvedValue([
        { id: "pt-1" },
        { id: "pt-2" },
      ] as never);
      vi.mocked(prisma.userPlaylistTrack.deleteMany).mockResolvedValue({
        count: 2,
      } as never);

      const fd = new FormData();
      fd.append("intent", "bulk-remove-tracks");
      fd.append("trackIds", JSON.stringify(["pt-1", "pt-2"]));

      const response = await callAction(fd);

      expect(response).toMatchObject({
        data: { success: true },
      });
      expect(bumpUserPlaylistUpdatedAt).toHaveBeenCalledWith({
        playlistId: "playlist-1",
        userId: "user-1",
      });
    });
  });
});
