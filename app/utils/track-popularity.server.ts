import { cachified } from "#app/utils/cache.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { lruCache } from "./cache.server.ts";
import { type TrackPopularityStats } from "#app/utils/discover.ts";
import {
  formatCount as formatCountShared,
  formatPopularityStats as formatPopularityStatsShared,
} from "#app/utils/popularity-format.ts";

// Re-export shared types and functions for convenience
export { type TrackPopularityStats };
export const formatCount = formatCountShared;
export const formatPopularityStats = formatPopularityStatsShared;

/**
 * Cache TTL for popularity metrics: 10 minutes
 * Balances freshness with performance (prevents excessive DB queries)
 */
const POPULARITY_CACHE_TTL = 10 * 60 * 1000; // 10 minutes in milliseconds

/**
 * Get global play counts for multiple tracks
 * Uses batch loading to avoid N+1 queries
 *
 * @param trackIds - Array of track IDs to fetch play counts for
 * @returns Map of trackId -> play count (0 if no plays)
 */
export async function getTrackPlayCounts(trackIds: string[]): Promise<Map<string, number>> {
  if (trackIds.length === 0) {
    return new Map();
  }

  return cachified({
    key: `track-play-counts:${[...trackIds].sort().join(",")}`,
    cache: lruCache,
    ttl: POPULARITY_CACHE_TTL,
    async getFreshValue() {
      // Query play_completed events grouped by trackId
      const results = await prisma.usageEvent.groupBy({
        by: ["trackId"],
        where: {
          type: "play_completed",
          trackId: { in: trackIds },
        },
        _count: {
          id: true,
        },
      });

      // Convert to Map for O(1) lookups
      const countMap = new Map<string, number>();
      for (const result of results) {
        if (result.trackId) {
          countMap.set(result.trackId, result._count.id);
        }
      }

      return countMap;
    },
  });
}

/**
 * Get global like counts for multiple tracks
 * A "like" is defined as an active UserTrack record
 *
 * @param trackIds - Array of track IDs to fetch like counts for
 * @returns Map of trackId -> like count (0 if no likes)
 */
export async function getTrackLikeCounts(trackIds: string[]): Promise<Map<string, number>> {
  if (trackIds.length === 0) {
    return new Map();
  }

  return cachified({
    key: `track-like-counts:${[...trackIds].sort().join(",")}`,
    cache: lruCache,
    ttl: POPULARITY_CACHE_TTL,
    async getFreshValue() {
      // Query active UserTrack records grouped by trackId
      const results = await prisma.userTrack.groupBy({
        by: ["trackId"],
        where: {
          trackId: { in: trackIds },
          isActive: true,
          deletedAt: null,
        },
        _count: {
          userId: true,
        },
      });

      // Convert to Map for O(1) lookups
      const countMap = new Map<string, number>();
      for (const result of results) {
        countMap.set(result.trackId, result._count.userId);
      }

      return countMap;
    },
  });
}

/**
 * Get user-specific play counts for multiple tracks
 *
 * @param userId - User ID to fetch play counts for
 * @param trackIds - Array of track IDs to fetch play counts for
 * @returns Map of trackId -> user play count (0 if user has not played)
 */
export async function getUserTrackPlayCounts(
  userId: string,
  trackIds: string[],
): Promise<Map<string, number>> {
  if (trackIds.length === 0) {
    return new Map();
  }

  return cachified({
    key: `user-track-play-counts:${userId}:${[...trackIds].sort().join(",")}`,
    cache: lruCache,
    ttl: POPULARITY_CACHE_TTL,
    async getFreshValue() {
      // Query play_completed events for this user grouped by trackId
      const results = await prisma.usageEvent.groupBy({
        by: ["trackId"],
        where: {
          type: "play_completed",
          userId,
          trackId: { in: trackIds },
        },
        _count: {
          id: true,
        },
      });

      // Convert to Map for O(1) lookups
      const countMap = new Map<string, number>();
      for (const result of results) {
        if (result.trackId) {
          countMap.set(result.trackId, result._count.id);
        }
      }

      return countMap;
    },
  });
}

/**
 * Get comprehensive popularity stats for multiple tracks
 * Fetches global play counts, like counts, and user-specific play counts in parallel
 *
 * @param trackIds - Array of track IDs to fetch stats for
 * @param userId - Optional user ID to include personal stats
 * @returns Map of trackId -> TrackPopularityStats
 */
export async function getTrackPopularityStats(
  trackIds: string[],
  userId?: string,
): Promise<Map<string, TrackPopularityStats>> {
  if (trackIds.length === 0) {
    return new Map();
  }

  // Fetch all stats in parallel for best performance
  const [globalPlayCounts, globalLikeCounts, userPlayCounts] = await Promise.all([
    getTrackPlayCounts(trackIds),
    getTrackLikeCounts(trackIds),
    userId ? getUserTrackPlayCounts(userId, trackIds) : Promise.resolve(new Map<string, number>()),
  ]);

  // Combine into comprehensive stats map
  const statsMap = new Map<string, TrackPopularityStats>();
  for (const trackId of trackIds) {
    statsMap.set(trackId, {
      globalPlayCount: globalPlayCounts.get(trackId) ?? 0,
      globalLikeCount: globalLikeCounts.get(trackId) ?? 0,
      userPlayCount: userPlayCounts.get(trackId) ?? 0,
    });
  }

  return statsMap;
}
