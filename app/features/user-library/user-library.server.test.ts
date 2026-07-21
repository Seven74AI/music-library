import { describe, expect, test, vi, beforeEach } from "vitest";
import {
  addTrackToUserLibrary,
  addTracksToUserLibrary,
  removeTrackFromUserLibrary,
} from "./user-library.server";

vi.mock("#app/utils/db.server", () => ({
  prisma: {
    userTrack: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

describe("user-library", () => {
  let prisma: Awaited<typeof import("#app/utils/db.server")>["prisma"];

  beforeEach(async () => {
    prisma = (await import("#app/utils/db.server")).prisma;
    vi.clearAllMocks();
  });

  const userId = "user1";
  const trackId = "track1";

  describe("addTrackToUserLibrary", () => {
    test("creates a new UserTrack when track is not in library", async () => {
      vi.mocked(prisma.userTrack.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.userTrack.create).mockResolvedValue({
        id: "ut1",
        userId,
        trackId,
        isActive: true,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await addTrackToUserLibrary(trackId, userId);

      expect(result.success).toBe(true);
      expect(result.message).toBe("Track added to library");
      expect(prisma.userTrack.create).toHaveBeenCalledWith({
        data: { userId, trackId },
      });
    });

    test("returns success without creating when already in library", async () => {
      vi.mocked(prisma.userTrack.findUnique).mockResolvedValue({
        id: "ut1",
        userId,
        trackId,
        isActive: true,
        deletedAt: null,
      } as never);

      const result = await addTrackToUserLibrary(trackId, userId);

      expect(result.success).toBe(true);
      expect(result.message).toBe("Track already in library");
      expect(prisma.userTrack.create).not.toHaveBeenCalled();
    });

    test("reactivates soft-deleted record", async () => {
      vi.mocked(prisma.userTrack.findUnique).mockResolvedValue({
        id: "ut1",
        userId,
        trackId,
        isActive: false,
        deletedAt: new Date(),
      } as never);
      vi.mocked(prisma.userTrack.update).mockResolvedValue({
        id: "ut1",
        isActive: true,
        deletedAt: null,
      } as never);

      const result = await addTrackToUserLibrary(trackId, userId);

      expect(result.success).toBe(true);
      expect(result.message).toBe("Track re-added to library");
      expect(prisma.userTrack.update).toHaveBeenCalledWith({
        where: { id: "ut1" },
        data: { isActive: true, deletedAt: null },
      });
    });

    test("handles database errors gracefully", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(prisma.userTrack.findUnique).mockRejectedValue(new Error("DB connection failed"));

      const result = await addTrackToUserLibrary(trackId, userId);

      expect(result.success).toBe(false);
      expect(result.message).toBe("Failed to add track to library");
      expect(result.error).toBe("DB connection failed");
      consoleError.mockRestore();
    });
  });

  describe("addTracksToUserLibrary", () => {
    test("creates many UserTracks in one transaction", async () => {
      vi.mocked(prisma.userTrack.findMany).mockResolvedValue([]);
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
        (fn as (tx: unknown) => Promise<unknown>)({
          userTrack: {
            updateMany: vi.fn().mockResolvedValue({ count: 0 }),
            createMany: vi.fn().mockResolvedValue({ count: 3 }),
          },
        }),
      );

      const result = await addTracksToUserLibrary(["track1", "track2", "track3"], userId);

      expect(result.success).toBe(true);
      expect(result.addedCount).toBe(3);
      expect(prisma.userTrack.findMany).toHaveBeenCalledWith({
        where: { userId, trackId: { in: ["track1", "track2", "track3"] } },
      });
    });

    test("reactivates inactive tracks and creates only missing ones", async () => {
      vi.mocked(prisma.userTrack.findMany).mockResolvedValue([
        { id: "ut1", userId, trackId: "track1", isActive: true, deletedAt: null },
        { id: "ut2", userId, trackId: "track2", isActive: false, deletedAt: new Date() },
      ] as never);
      const updateMany = vi.fn().mockResolvedValue({ count: 1 });
      const createMany = vi.fn().mockResolvedValue({ count: 1 });
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
        (fn as (tx: unknown) => Promise<unknown>)({
          userTrack: { updateMany, createMany },
        }),
      );

      const result = await addTracksToUserLibrary(["track1", "track2", "track3"], userId);

      expect(result.success).toBe(true);
      expect(result.addedCount).toBe(2);
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["ut2"] } },
        data: { isActive: true, deletedAt: null },
      });
      expect(createMany).toHaveBeenCalledWith({
        data: [{ userId, trackId: "track3" }],
      });
    });

    test("deduplicates track ids", async () => {
      vi.mocked(prisma.userTrack.findMany).mockResolvedValue([]);
      const createMany = vi.fn().mockResolvedValue({ count: 1 });
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
        (fn as (tx: unknown) => Promise<unknown>)({
          userTrack: { updateMany: vi.fn(), createMany },
        }),
      );

      await addTracksToUserLibrary(["track1", "track1"], userId);

      expect(prisma.userTrack.findMany).toHaveBeenCalledWith({
        where: { userId, trackId: { in: ["track1"] } },
      });
    });

    test("chunks large bulk add queries to stay under SQLite bind limits", async () => {
      const largeTrackIds = Array.from({ length: 1200 }, (_, i) => `track${i}`);
      vi.mocked(prisma.userTrack.findMany).mockResolvedValue([]);
      const createMany = vi.fn().mockResolvedValue({ count: 500 });
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
        (fn as (tx: unknown) => Promise<unknown>)({
          userTrack: { updateMany: vi.fn(), createMany },
        }),
      );

      const result = await addTracksToUserLibrary(largeTrackIds, userId);

      expect(result.success).toBe(true);
      expect(result.addedCount).toBe(1200);
      expect(prisma.userTrack.findMany).toHaveBeenCalledTimes(3);
      expect(createMany).toHaveBeenCalledTimes(3);
      expect(createMany.mock.calls[0]?.[0]?.data).toHaveLength(500);
      expect(createMany.mock.calls[2]?.[0]?.data).toHaveLength(200);
    });

    test("returns success with zero count for empty list", async () => {
      const result = await addTracksToUserLibrary([], userId);

      expect(result.success).toBe(true);
      expect(result.addedCount).toBe(0);
      expect(prisma.userTrack.findMany).not.toHaveBeenCalled();
    });
  });

  describe("removeTrackFromUserLibrary", () => {
    test("soft-deletes an active user track", async () => {
      vi.mocked(prisma.userTrack.findUnique).mockResolvedValue({
        id: "ut1",
        userId,
        trackId,
        isActive: true,
        deletedAt: null,
      } as never);
      vi.mocked(prisma.userTrack.update).mockResolvedValue({
        id: "ut1",
        isActive: false,
        deletedAt: new Date(),
      } as never);

      const result = await removeTrackFromUserLibrary(trackId, userId);

      expect(result.success).toBe(true);
      expect(result.message).toBe("Track removed from library");
      expect(prisma.userTrack.update).toHaveBeenCalledWith({
        where: { id: "ut1" },
        data: { isActive: false, deletedAt: expect.any(Date) },
      });
    });

    test("returns failure when track not found", async () => {
      vi.mocked(prisma.userTrack.findUnique).mockResolvedValue(null);

      const result = await removeTrackFromUserLibrary(trackId, userId);

      expect(result.success).toBe(false);
      expect(result.message).toBe("Track not found in library");
      expect(prisma.userTrack.update).not.toHaveBeenCalled();
    });

    test("returns failure when track already inactive", async () => {
      vi.mocked(prisma.userTrack.findUnique).mockResolvedValue({
        id: "ut1",
        userId,
        trackId,
        isActive: false,
        deletedAt: new Date(),
      } as never);

      const result = await removeTrackFromUserLibrary(trackId, userId);

      expect(result.success).toBe(false);
      expect(result.message).toBe("Track not found in library");
      expect(prisma.userTrack.update).not.toHaveBeenCalled();
    });

    test("handles database errors gracefully", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(prisma.userTrack.findUnique).mockRejectedValue(new Error("DB connection failed"));

      const result = await removeTrackFromUserLibrary(trackId, userId);

      expect(result.success).toBe(false);
      expect(result.message).toBe("Failed to remove track from library");
      expect(result.error).toBe("DB connection failed");
      consoleError.mockRestore();
    });
  });
});
