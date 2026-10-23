/**
 * Common YouTube utility functions
 * Centralized functions to avoid code duplication across YouTube-related modules
 */

// Common type for YouTube video data transformation
export interface VideoData {
  id: string;
  title: string;
  artist: string;
  duration: number | null;
  thumbnailUrl: string;
  serviceUrl: string;
  publishedAt: string;
}

/**
 * Convert ISO 8601 duration to seconds
 * PT4M13S -> 253 seconds
 * Returns null for invalid or empty durations
 */
export function parseDuration(duration: string): number | null {
  if (!duration || duration.trim() === "") return null;

  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return null;

  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  const seconds = parseInt(match[3] || "0", 10);

  const totalSeconds = hours * 3600 + minutes * 60 + seconds;
  return totalSeconds > 0 ? totalSeconds : null;
}
