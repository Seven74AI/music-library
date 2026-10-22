/**
 * Shared constants and utilities for Admin Database Quality & Health Monitoring
 * Can be used by both server and client code.
 */

export const METRIC_WEIGHTS = {
  audio: 0.3,
  covers: 0.25,
  duration: 0.15,
  album: 0.1,
  year: 0.1,
  genre: 0.05,
  lyrics: 0.05,
} as const;

export interface MetricTarget {
  audio: number;
  covers: number;
  duration: number;
  album: number;
  year: number;
  genre: number;
  lyrics: number;
}

export const METRIC_TARGETS: MetricTarget = {
  audio: 100,
  covers: 95,
  duration: 99,
  album: 80,
  year: 85,
  genre: 60,
  lyrics: 10,
} as const;

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * Percent of tracks that have at least one track-level metadata issue.
 * `tracksWithIssues` must be a distinct track count. Issue buckets overlap, and
 * artists without a genre are not tracks, so those figures are not a numerator.
 * The result stays within 0–100.
 */
export function percentOfTracksAffected(tracksWithIssues: number, totalTracks: number): number {
  if (totalTracks <= 0) return 0;
  const percent = (tracksWithIssues / totalTracks) * 100;
  if (!Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, percent));
}
