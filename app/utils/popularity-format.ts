import { type TrackPopularityStats } from "#app/utils/discover.ts";

/**
 * Format a number with thousands separators (e.g., 1234 -> "1,234")
 */
export function formatCount(count: number): string {
  return count.toLocaleString("en-US");
}

/**
 * Format popularity stats as a human-readable string
 * Format: "You: 12 plays • 1,234 plays total • 89 likes"
 *
 * @param stats - Popularity stats for a track
 * @param includeUserStats - Whether to include user-specific stats
 * @returns Formatted string or null if no stats to display
 */
export function formatPopularityStats(
  stats: TrackPopularityStats | undefined,
  includeUserStats: boolean = false,
): string | null {
  if (!stats) {
    return null;
  }

  const parts: string[] = [];

  // Add user-specific play count if available and requested
  if (includeUserStats && stats.userPlayCount > 0) {
    parts.push(`You: ${stats.userPlayCount} ${stats.userPlayCount === 1 ? "play" : "plays"}`);
  }

  // Add global play count if available
  if (stats.globalPlayCount > 0) {
    parts.push(
      `${formatCount(stats.globalPlayCount)} ${stats.globalPlayCount === 1 ? "play" : "plays"} total`,
    );
  }

  // Add like count if available
  if (stats.globalLikeCount > 0) {
    parts.push(
      `${formatCount(stats.globalLikeCount)} ${stats.globalLikeCount === 1 ? "like" : "likes"}`,
    );
  }

  // Return null if no stats to display
  if (parts.length === 0) {
    return null;
  }

  return parts.join(" • ");
}
