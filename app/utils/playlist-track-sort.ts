import { applySortDirection, type SortDirection } from "#app/utils/sort-direction.ts";

export const PLAYLIST_TRACK_SORT_OPTIONS = [
  "custom",
  "title",
  "artist",
  "duration",
  "dateAdded",
] as const;

export type PlaylistTrackSortOption = (typeof PLAYLIST_TRACK_SORT_OPTIONS)[number];

export function parsePlaylistTrackSort(raw: string | null | undefined): PlaylistTrackSortOption {
  return PLAYLIST_TRACK_SORT_OPTIONS.includes(raw as PlaylistTrackSortOption)
    ? (raw as PlaylistTrackSortOption)
    : "custom";
}

/** Default direction preserves pre-direction behavior for each field. */
export function defaultPlaylistTrackSortDirection(sort: PlaylistTrackSortOption): SortDirection {
  if (sort === "dateAdded") return "desc";
  return "asc";
}

type SortablePlaylistTrack = {
  position: number;
  createdAt?: string | Date | null;
  track: {
    title: string;
    artist: { name: string };
    duration: number | null;
  };
};

function compareNullableNumbers(
  a: number | null,
  b: number | null,
  direction: SortDirection,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return applySortDirection(a - b, direction);
}

function toTime(value: string | Date | null | undefined): number {
  if (value == null) return 0;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function sortPlaylistTracks<T extends SortablePlaylistTrack>(
  tracks: T[],
  sort: PlaylistTrackSortOption,
  direction: SortDirection = defaultPlaylistTrackSortDirection(sort),
): T[] {
  if (sort === "custom") {
    return [...tracks].sort((a, b) => a.position - b.position);
  }

  return [...tracks].sort((a, b) => {
    switch (sort) {
      case "title":
        return applySortDirection(a.track.title.localeCompare(b.track.title), direction);
      case "artist":
        return applySortDirection(
          a.track.artist.name.localeCompare(b.track.artist.name),
          direction,
        );
      case "duration":
        return compareNullableNumbers(a.track.duration, b.track.duration, direction);
      case "dateAdded":
        return applySortDirection(toTime(a.createdAt) - toTime(b.createdAt), direction);
      default:
        return 0;
    }
  });
}
