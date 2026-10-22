import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { type TrackPopularityStats } from "#app/utils/discover.ts";
import {
  getTrackPlayCounts,
  getTrackLikeCounts,
  getUserTrackPlayCounts,
  getTrackPopularityStats,
} from "./track-popularity.server.ts";
import { formatCount, formatPopularityStats } from "./popularity-format.ts";

// Mock the cache module
vi.mock("#app/utils/cache.server.ts", () => ({
  cachified: vi.fn(async ({ getFreshValue }) => getFreshValue()),
  lruCache: {},
}));

describe("Track Popularity Functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getTrackPlayCounts", () => {
    it("should return empty map for empty input", async () => {
      const result = await getTrackPlayCounts([]);
      expect(result.size).toBe(0);
    });

    it("should return play counts for tracks", async () => {
      const mockResults = [
        { trackId: "track-1", _count: { id: 10 } },
        { trackId: "track-2", _count: { id: 5 } },
      ];

      vi.spyOn(prisma.usageEvent, "groupBy").mockResolvedValue(mockResults as never);

      const result = await getTrackPlayCounts(["track-1", "track-2"]);

      expect(result.get("track-1")).toBe(10);
      expect(result.get("track-2")).toBe(5);
      expect(prisma.usageEvent.groupBy).toHaveBeenCalledWith({
        by: ["trackId"],
        where: {
          type: "play_completed",
          trackId: { in: ["track-1", "track-2"] },
        },
        _count: {
          id: true,
        },
      });
    });

    it("should handle tracks with no plays", async () => {
      vi.spyOn(prisma.usageEvent, "groupBy").mockResolvedValue([] as never);

      const result = await getTrackPlayCounts(["track-1", "track-2"]);

      expect(result.get("track-1")).toBeUndefined();
      expect(result.get("track-2")).toBeUndefined();
      expect(result.size).toBe(0);
    });

    it("should filter out null trackIds", async () => {
      const mockResults = [
        { trackId: "track-1", _count: { id: 10 } },
        { trackId: null, _count: { id: 5 } },
      ];

      vi.spyOn(prisma.usageEvent, "groupBy").mockResolvedValue(mockResults as never);

      const result = await getTrackPlayCounts(["track-1"]);

      expect(result.size).toBe(1);
      expect(result.get("track-1")).toBe(10);
    });
  });

  describe("getTrackLikeCounts", () => {
    it("should return empty map for empty input", async () => {
      const result = await getTrackLikeCounts([]);
      expect(result.size).toBe(0);
    });

    it("should return like counts for tracks", async () => {
      const mockResults = [
        { trackId: "track-1", _count: { userId: 15 } },
        { trackId: "track-2", _count: { userId: 8 } },
      ];

      vi.spyOn(prisma.userTrack, "groupBy").mockResolvedValue(mockResults as never);

      const result = await getTrackLikeCounts(["track-1", "track-2"]);

      expect(result.get("track-1")).toBe(15);
      expect(result.get("track-2")).toBe(8);
      expect(prisma.userTrack.groupBy).toHaveBeenCalledWith({
        by: ["trackId"],
        where: {
          trackId: { in: ["track-1", "track-2"] },
          isActive: true,
          deletedAt: null,
        },
        _count: {
          userId: true,
        },
      });
    });

    it("should handle tracks with no likes", async () => {
      vi.spyOn(prisma.userTrack, "groupBy").mockResolvedValue([] as never);

      const result = await getTrackLikeCounts(["track-1", "track-2"]);

      expect(result.get("track-1")).toBeUndefined();
      expect(result.get("track-2")).toBeUndefined();
      expect(result.size).toBe(0);
    });
  });

  describe("getUserTrackPlayCounts", () => {
    it("should return empty map for empty input", async () => {
      const result = await getUserTrackPlayCounts("user-1", []);
      expect(result.size).toBe(0);
    });

    it("should return user play counts for tracks", async () => {
      const mockResults = [
        { trackId: "track-1", _count: { id: 3 } },
        { trackId: "track-2", _count: { id: 7 } },
      ];

      vi.spyOn(prisma.usageEvent, "groupBy").mockResolvedValue(mockResults as never);

      const result = await getUserTrackPlayCounts("user-1", ["track-1", "track-2"]);

      expect(result.get("track-1")).toBe(3);
      expect(result.get("track-2")).toBe(7);
      expect(prisma.usageEvent.groupBy).toHaveBeenCalledWith({
        by: ["trackId"],
        where: {
          type: "play_completed",
          userId: "user-1",
          trackId: { in: ["track-1", "track-2"] },
        },
        _count: {
          id: true,
        },
      });
    });

    it("should handle user with no plays", async () => {
      vi.spyOn(prisma.usageEvent, "groupBy").mockResolvedValue([] as never);

      const result = await getUserTrackPlayCounts("user-1", ["track-1", "track-2"]);

      expect(result.get("track-1")).toBeUndefined();
      expect(result.get("track-2")).toBeUndefined();
      expect(result.size).toBe(0);
    });

    it("should filter out null trackIds", async () => {
      const mockResults = [
        { trackId: "track-1", _count: { id: 3 } },
        { trackId: null, _count: { id: 1 } },
      ];

      vi.spyOn(prisma.usageEvent, "groupBy").mockResolvedValue(mockResults as never);

      const result = await getUserTrackPlayCounts("user-1", ["track-1"]);

      expect(result.size).toBe(1);
      expect(result.get("track-1")).toBe(3);
    });
  });

  describe("getTrackPopularityStats", () => {
    it("should return empty map for empty input", async () => {
      const result = await getTrackPopularityStats([]);
      expect(result.size).toBe(0);
    });

    it("should combine all stats without userId", async () => {
      vi.spyOn(prisma.usageEvent, "groupBy").mockResolvedValueOnce([
        { trackId: "track-1", _count: { id: 100 } },
      ] as never);

      vi.spyOn(prisma.userTrack, "groupBy").mockResolvedValueOnce([
        { trackId: "track-1", _count: { userId: 50 } },
      ] as never);

      const result = await getTrackPopularityStats(["track-1"]);

      expect(result.size).toBe(1);
      expect(result.get("track-1")).toEqual({
        globalPlayCount: 100,
        globalLikeCount: 50,
        userPlayCount: 0,
      });
    });

    it("should combine all stats with userId", async () => {
      vi.spyOn(prisma.usageEvent, "groupBy")
        .mockResolvedValueOnce([{ trackId: "track-1", _count: { id: 100 } }] as never)
        .mockResolvedValueOnce([{ trackId: "track-1", _count: { id: 5 } }] as never);

      vi.spyOn(prisma.userTrack, "groupBy").mockResolvedValueOnce([
        { trackId: "track-1", _count: { userId: 50 } },
      ] as never);

      const result = await getTrackPopularityStats(["track-1"], "user-1");

      expect(result.size).toBe(1);
      expect(result.get("track-1")).toEqual({
        globalPlayCount: 100,
        globalLikeCount: 50,
        userPlayCount: 5,
      });
    });

    it("should handle tracks with no stats", async () => {
      vi.spyOn(prisma.usageEvent, "groupBy").mockResolvedValue([] as never);
      vi.spyOn(prisma.userTrack, "groupBy").mockResolvedValue([] as never);

      const result = await getTrackPopularityStats(["track-1", "track-2"]);

      expect(result.size).toBe(2);
      expect(result.get("track-1")).toEqual({
        globalPlayCount: 0,
        globalLikeCount: 0,
        userPlayCount: 0,
      });
      expect(result.get("track-2")).toEqual({
        globalPlayCount: 0,
        globalLikeCount: 0,
        userPlayCount: 0,
      });
    });

    it("should handle partial stats", async () => {
      vi.spyOn(prisma.usageEvent, "groupBy")
        .mockResolvedValueOnce([{ trackId: "track-1", _count: { id: 10 } }] as never)
        .mockResolvedValueOnce([] as never);

      vi.spyOn(prisma.userTrack, "groupBy").mockResolvedValueOnce([
        { trackId: "track-2", _count: { userId: 5 } },
      ] as never);

      const result = await getTrackPopularityStats(["track-1", "track-2"], "user-1");

      expect(result.size).toBe(2);
      expect(result.get("track-1")).toEqual({
        globalPlayCount: 10,
        globalLikeCount: 0,
        userPlayCount: 0,
      });
      expect(result.get("track-2")).toEqual({
        globalPlayCount: 0,
        globalLikeCount: 5,
        userPlayCount: 0,
      });
    });
  });

  describe("formatCount", () => {
    it("should format numbers with thousands separators", () => {
      expect(formatCount(1)).toBe("1");
      expect(formatCount(12)).toBe("12");
      expect(formatCount(123)).toBe("123");
      expect(formatCount(1234)).toBe("1,234");
      expect(formatCount(12345)).toBe("12,345");
      expect(formatCount(123456)).toBe("123,456");
      expect(formatCount(1234567)).toBe("1,234,567");
    });

    it("should handle zero", () => {
      expect(formatCount(0)).toBe("0");
    });
  });

  describe("formatPopularityStats", () => {
    it("should return null for undefined stats", () => {
      expect(formatPopularityStats(undefined)).toBeNull();
    });

    it("should return null when all stats are zero", () => {
      const stats: TrackPopularityStats = {
        globalPlayCount: 0,
        globalLikeCount: 0,
        userPlayCount: 0,
      };
      expect(formatPopularityStats(stats)).toBeNull();
    });

    it("should format only global plays", () => {
      const stats: TrackPopularityStats = {
        globalPlayCount: 1234,
        globalLikeCount: 0,
        userPlayCount: 0,
      };
      expect(formatPopularityStats(stats)).toBe("1,234 plays total");
    });

    it("should format only global likes", () => {
      const stats: TrackPopularityStats = {
        globalPlayCount: 0,
        globalLikeCount: 89,
        userPlayCount: 0,
      };
      expect(formatPopularityStats(stats)).toBe("89 likes");
    });

    it("should format global plays and likes", () => {
      const stats: TrackPopularityStats = {
        globalPlayCount: 1234,
        globalLikeCount: 89,
        userPlayCount: 0,
      };
      expect(formatPopularityStats(stats)).toBe("1,234 plays total • 89 likes");
    });

    it("should include user plays when requested and available", () => {
      const stats: TrackPopularityStats = {
        globalPlayCount: 1234,
        globalLikeCount: 89,
        userPlayCount: 12,
      };
      expect(formatPopularityStats(stats, true)).toBe(
        "You: 12 plays • 1,234 plays total • 89 likes",
      );
    });

    it("should not include user plays when not requested", () => {
      const stats: TrackPopularityStats = {
        globalPlayCount: 1234,
        globalLikeCount: 89,
        userPlayCount: 12,
      };
      expect(formatPopularityStats(stats, false)).toBe("1,234 plays total • 89 likes");
    });

    it("should handle singular forms", () => {
      const stats: TrackPopularityStats = {
        globalPlayCount: 1,
        globalLikeCount: 1,
        userPlayCount: 1,
      };
      expect(formatPopularityStats(stats, true)).toBe("You: 1 play • 1 play total • 1 like");
    });

    it("should skip user plays when zero even if requested", () => {
      const stats: TrackPopularityStats = {
        globalPlayCount: 100,
        globalLikeCount: 50,
        userPlayCount: 0,
      };
      expect(formatPopularityStats(stats, true)).toBe("100 plays total • 50 likes");
    });

    it("should handle only user plays", () => {
      const stats: TrackPopularityStats = {
        globalPlayCount: 0,
        globalLikeCount: 0,
        userPlayCount: 5,
      };
      expect(formatPopularityStats(stats, true)).toBe("You: 5 plays");
    });
  });
});
