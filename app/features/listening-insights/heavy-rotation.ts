/**
 * Heavy Rotation pure helpers (ADR-026 / decision #63).
 *
 * Tie-break when completed-play counts are equal (including both zero):
 * 1. Newer `createdAt` first (desc)
 * 2. Lexicographically smaller `id` first (asc) for stability
 *
 * Tracks with count 0 (or missing from the counts map) sort after any track
 * with count > 0 — that falls out of descending numeric compare.
 */

export const HEAVY_ROTATION_HOME_CAP = 50;

export const HEAVY_ROTATION_WINDOWS = ["month", "ever"] as const;
export type HeavyRotationWindow = (typeof HEAVY_ROTATION_WINDOWS)[number];

/** Library sort values; most-played options are mutually exclusive. */
export const LIBRARY_SORT_OPTIONS = ["dateAdded", "mostPlayedMonth", "mostPlayedEver"] as const;

export type LibrarySortOption = (typeof LIBRARY_SORT_OPTIONS)[number];

export const DEFAULT_LIBRARY_SORT: LibrarySortOption = "dateAdded";

/** All library sorts default to descending (newest / most-played first). */
export function defaultLibrarySortDirection(
  _sort: LibrarySortOption = DEFAULT_LIBRARY_SORT,
): "asc" | "desc" {
  return "desc";
}

export function parseLibrarySort(raw: string | null | undefined): LibrarySortOption {
  return LIBRARY_SORT_OPTIONS.includes(raw as LibrarySortOption)
    ? (raw as LibrarySortOption)
    : DEFAULT_LIBRARY_SORT;
}

export function librarySortToWindow(sort: LibrarySortOption): HeavyRotationWindow | null {
  if (sort === "mostPlayedMonth") return "month";
  if (sort === "mostPlayedEver") return "ever";
  return null;
}

export type PlayCountSortable = {
  id: string;
  trackId: string;
  createdAt: Date | string;
};

function toTime(value: Date | string): number {
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

/**
 * Compare two library rows by play_completed count descending.
 * Zero/missing counts sort after positive counts; ties use createdAt desc, then id asc.
 */
export function compareByPlayCompletedCount(
  a: PlayCountSortable,
  b: PlayCountSortable,
  counts: ReadonlyMap<string, number>,
): number {
  const countA = counts.get(a.trackId) ?? 0;
  const countB = counts.get(b.trackId) ?? 0;
  if (countB !== countA) return countB - countA;

  const timeDiff = toTime(b.createdAt) - toTime(a.createdAt);
  if (timeDiff !== 0) return timeDiff;

  return a.id.localeCompare(b.id);
}

export function sortByPlayCompletedCount<T extends PlayCountSortable>(
  items: T[],
  counts: ReadonlyMap<string, number>,
  direction: "asc" | "desc" = "desc",
): T[] {
  const dir = direction === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    const countA = counts.get(a.trackId) ?? 0;
    const countB = counts.get(b.trackId) ?? 0;
    const countDiff = (countA - countB) * dir;
    if (countDiff !== 0) return countDiff;

    // Tie-breaks are direction-independent: newer createdAt first, then id asc.
    // (Reversing a desc sort here would silently flip both sub-keys for "asc".)
    const timeDiff = toTime(b.createdAt) - toTime(a.createdAt);
    if (timeDiff !== 0) return timeDiff;

    return a.id.localeCompare(b.id);
  });
}

/** Track tile shape for home Heavy Rotation strips (client-safe). */
export type HeavyRotationTrack = {
  completedCount: number;
  track: {
    id: string;
    title: string;
    duration: number | null;
    serviceUrl: string | null;
    artist: { id: string; name: string };
    coverImage: { objectKey: string } | null;
    service: { name: string; displayName: string; logoUrl: string | null } | null;
    audioFiles: Array<{ id: string; format: string | null; objectKey: string }>;
  };
};
