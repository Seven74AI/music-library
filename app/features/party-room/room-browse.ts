/**
 * Client-safe paths for browsing the playable catalog inside a party room.
 * Guests stay under `/rooms/:code` so the guest-return redirect does not
 * bounce them out of album and artist pages.
 */

export const ROOM_BROWSE_TYPES = ["all", "tracks", "albums", "artists"] as const;

export type RoomBrowseType = (typeof ROOM_BROWSE_TYPES)[number];

export type RoomSearchReturnState = {
  q: string;
  type: RoomBrowseType;
};

export type RoomCatalogTrack = {
  id: string;
  title: string;
  artistName: string;
  artistId: string;
  albumName: string | null;
  albumId: string | null;
  duration: number | null;
  trackNumber?: number | null;
};

export function isRoomBrowseType(value: unknown): value is RoomBrowseType {
  return typeof value === "string" && (ROOM_BROWSE_TYPES as readonly string[]).includes(value);
}

export function parseRoomBrowseType(value: string | null | undefined): RoomBrowseType {
  return isRoomBrowseType(value) ? value : "all";
}

export function roomSearchHref(
  code: string,
  query?: { q?: string; type?: RoomBrowseType },
): string {
  const params = new URLSearchParams();
  const q = query?.q?.trim() ?? "";
  if (q) params.set("q", q);
  if (query?.type && query.type !== "all") params.set("type", query.type);
  const qs = params.toString();
  return `/rooms/${code}/search${qs ? `?${qs}` : ""}`;
}

export function roomAlbumHref(code: string, albumId: string): string {
  return `/rooms/${code}/search/albums/${albumId}`;
}

export function roomArtistHref(code: string, artistId: string): string {
  return `/rooms/${code}/search/artists/${artistId}`;
}

export function readRoomSearchReturn(state: unknown): RoomSearchReturnState {
  if (!state || typeof state !== "object") return { q: "", type: "all" };
  const record = state as Record<string, unknown>;
  return {
    q: typeof record.q === "string" ? record.q : "",
    type: parseRoomBrowseType(typeof record.type === "string" ? record.type : null),
  };
}

/** Shown when the artist page cannot list every playable track at once. */
export function roomArtistTrackNote(shown: number, total: number): string | null {
  if (total <= shown) return null;
  return `Showing ${shown} of ${total} playable tracks`;
}
