import { type FullTrack, type QueueTrack } from "#app/types/frontend/shared.ts";
import { type LibrarySortOption } from "#app/features/listening-insights/heavy-rotation.ts";
import {
  DEFAULT_DISCOVER_SORT,
  defaultDiscoverSortDirection,
  type DiscoverSortOption,
} from "#app/utils/discover.ts";
import { type PlaylistTrackSortOption } from "#app/utils/playlist-track-sort.ts";
import { type SortDirection } from "#app/utils/sort-direction.ts";

export class AuthExpiredError extends Error {
  constructor() {
    super("Auth session expired");
    this.name = "AuthExpiredError";
  }
}

export type QueueSpineContext =
  | { type: "library"; sort?: LibrarySortOption; direction?: SortDirection }
  | {
      type: "playlist";
      playlistId: string;
      sort?: PlaylistTrackSortOption;
      direction?: SortDirection;
    }
  | { type: "artist"; artistId: string }
  | { type: "album"; albumId: string }
  | { type: "track"; trackId: string }
  | { type: "onRepeatSnapshot"; snapshotId: string }
  | { type: "discover"; sort?: DiscoverSortOption; direction?: SortDirection };

export type QueueSpineResponse = {
  tracks: QueueTrack[];
  total: number;
};

export async function fetchQueueSpine(context: QueueSpineContext): Promise<QueueSpineResponse> {
  let url: string;

  if (context.type === "library") {
    const params = new URLSearchParams({
      context: "library",
      hasAudio: "1",
    });
    if (context.sort && context.sort !== "dateAdded") {
      params.set("sort", context.sort);
    }
    if (context.direction && context.direction !== "desc") {
      params.set("dir", context.direction);
    }
    url = `/api/queue-spine?${params.toString()}`;
  } else if (context.type === "playlist") {
    const params = new URLSearchParams({
      context: "playlist",
      playlistId: context.playlistId,
    });
    if (context.sort && context.sort !== "custom") {
      params.set("sort", context.sort);
    }
    if (context.direction) {
      params.set("dir", context.direction);
    }
    url = `/api/queue-spine?${params.toString()}`;
  } else if (context.type === "artist") {
    url = `/api/queue-spine?context=artist&artistId=${encodeURIComponent(context.artistId)}`;
  } else if (context.type === "album") {
    url = `/api/queue-spine?context=album&albumId=${encodeURIComponent(context.albumId)}`;
  } else if (context.type === "onRepeatSnapshot") {
    url = `/api/queue-spine?context=onRepeatSnapshot&snapshotId=${encodeURIComponent(context.snapshotId)}`;
  } else if (context.type === "discover") {
    const params = new URLSearchParams({ context: "discover" });
    const sort = context.sort ?? DEFAULT_DISCOVER_SORT;
    if (sort !== DEFAULT_DISCOVER_SORT) params.set("sort", sort);
    const direction = context.direction ?? defaultDiscoverSortDirection(sort);
    if (direction !== defaultDiscoverSortDirection(sort)) params.set("dir", direction);
    url = `/api/queue-spine?${params.toString()}`;
  } else {
    url = `/api/queue-spine?context=track&trackId=${encodeURIComponent(context.trackId)}`;
  }

  const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
  const response = await fetch(`${base}${url}`, { redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    // Only an explicit redirect to the login route signals session expiry.
    // Any other redirect — a trailing-slash/canonical-host rewrite, or a
    // malformed 3xx missing its Location header — is NOT an auth-expiry
    // signal; it falls through to the generic non-ok error below.
    if (location && isLoginPath(location)) {
      throw new AuthExpiredError();
    }
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch queue spine: ${response.status}`);
  }

  const data: unknown = await response.json();
  if (!isQueueSpineResponse(data)) {
    throw new Error("Invalid queue spine response");
  }
  return data;
}

/**
 * Runtime guard for the queue-spine payload. Validates the two fields the
 * caller actually reads so a malformed body fails loudly instead of silently
 * propagating an unchecked cast.
 */
function isQueueSpineResponse(value: unknown): value is QueueSpineResponse {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.tracks) && typeof record.total === "number";
}

/**
 * True when a redirect Location targets the login route (relative or absolute).
 * React Router's auth gate issues `redirect("/login[?…]")`, which surfaces as a
 * 302 with a `/login` path.
 */
function isLoginPath(location: string): boolean {
  try {
    return new URL(location, "http://queue-spine.invalid").pathname === "/login";
  } catch {
    return location === "/login" || location.startsWith("/login?");
  }
}

export function queueTrackFromFullTrack(track: FullTrack): QueueTrack {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
  };
}

export function fullTrackStubFromQueueTrack(track: QueueTrack): FullTrack {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    duration: null,
    coverImage: null,
    audioFiles: [],
  };
}
