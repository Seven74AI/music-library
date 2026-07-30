import {
  getCachedPlaylistMetadata,
  listCachedPlaylists,
  type CachedPlaylistMeta,
} from "#app/features/offline-storage/offline-playlist-metadata.client.ts";
import { getOfflineStorage } from "#app/features/offline-storage/offline-storage.client.ts";
import { type OfflineTrackSummary } from "#app/features/offline-storage/types.ts";
import { LIBRARY_TRACKS_PAGE_SIZE } from "#app/utils/library-tracks-pagination.ts";
import { createFallbackOfflineRootShell } from "./offline-root-shell.client.ts";
import {
  OFFLINE_ADMIN_AUDIO_QUEUE,
  OFFLINE_EMPTY,
  OFFLINE_MUSIC_SERVICES,
  OFFLINE_PASSKEYS,
  OFFLINE_SEARCH,
  OFFLINE_YOUTUBE_INDEX,
  OFFLINE_YOUTUBE_PLAYLISTS,
  OFFLINE_YOUTUBE_SYNCED,
  offlineTrackDetailFallback,
  offlineYoutubePlaylistFallback,
} from "./offline-stubs.client.ts";

// ── Types ────────────────────────────────────────────────────────────────────

export type DownloadsOfflineLoaderData = {
  tracks: Awaited<ReturnType<ReturnType<typeof getOfflineStorage>["listDownloaded"]>>;
  stats: Awaited<ReturnType<ReturnType<typeof getOfflineStorage>["getStorageStats"]>>;
};

export type HomeOfflineLoaderData = { mode: "offline" };

export type LibraryOfflineLoaderData = {
  offline: true;
  offlineTracks: OfflineTrackSummary[];
  userTracks: [];
  pagination: { limit: number; hasNext: false; nextCursor: null };
  hasAudioOnly: false;
  playlists: [];
};

export type PlaylistsIndexOfflineLoaderData = {
  offline: true;
  offlinePlaylists: Array<CachedPlaylistMeta & { trackCount: number }>;
  playlists: [];
  pagination: { limit: 12; hasNext: false; nextCursor: null };
};

export type PlaylistDetailOfflineLoaderData = {
  offline: true;
  offlineTracks: OfflineTrackSummary[];
  offlinePlaylistMeta: CachedPlaylistMeta;
  playlist: null;
  playlists: [];
};

export type OfflineStubValue =
  | { kind: "empty" }
  | { kind: "constant"; value: unknown }
  | {
      kind: "pathname";
      segmentIndex: number;
      fn: (value: string) => unknown;
    };

/** Async stub — resolves at middleware runtime (for storage-dependent fallbacks). */
export type AsyncOfflineStubFn = (args: {
  request: Request;
  /** Route params extracted from the URL path by segment position. */
  params: Record<string, string | undefined>;
}) => unknown | Promise<unknown>;

// ── Redirects ────────────────────────────────────────────────────────────────

export const OFFLINE_REDIRECTS: Array<{
  matchPathname: (pathname: string) => boolean;
  to: string;
}> = [{ matchPathname: (pathname) => pathname === "/me", to: "/downloads" }];

// ── Skip prefixes — routes that should NEVER get offline stubs  ──────────────
// (API/resource/auth routes returning raw data, not rendered pages)

const OFFLINE_MIDDLEWARE_SKIP_PREFIXES = ["routes/resources+/", "routes/api+/", "routes/_auth+/"];

// ── Offline route stubs — one unified map  ───────────────────────────────────
//
// Every route that needs offline fallback data gets an entry here.
// Routes NOT in this map (and not skipped) get OFFLINE_EMPTY ({}).
//
// For async stubs that need IndexedDB/localStorage (library, downloads,
// playlists), use the asyncFn utility below.

type StubEntry =
  | { kind: "sync"; value: OfflineStubValue }
  | { kind: "async"; fn: AsyncOfflineStubFn };

/**
 * Utility: wraps an async offline data function into a stub entry.
 */
function asyncFn(fn: AsyncOfflineStubFn): StubEntry {
  return { kind: "async", fn };
}

function sync(value: OfflineStubValue): StubEntry {
  return { kind: "sync", value };
}

// ── Stub parameter extraction helpers ────────────────────────────────────────

/**
 * Extracts a path segment at the given index from a URL.
 * Used by pathname-based stubs to get dynamic params (track IDs, playlist IDs).
 */
function segmentAt(url: string, index: number): string {
  return new URL(url).pathname.split("/").at(index) ?? "";
}

/**
 * Builds a params-like object from a URL path and a set of segment→name mappings.
 * e.g. paramsFromSegments(url, { 3: "playlistId" }) for /playlists/abc →
 *      { playlistId: "abc" }
 */
function paramsFromSegments(
  url: string,
  mappings: Record<number, string>,
): Record<string, string | undefined> {
  const segments = new URL(url).pathname.split("/");
  const params: Record<string, string | undefined> = {};
  for (const [idx, name] of Object.entries(mappings)) {
    params[name] = segments[Number(idx)];
  }
  return params;
}

// ── Offline route policies — THE unified map ─────────────────────────────────

export const OFFLINE_ROUTE_POLICIES: Record<string, StubEntry> = {
  // ── Live routes (converted from old "live" mode) ──

  root: sync({ kind: "constant", value: createFallbackOfflineRootShell() }),

  "routes/_marketing+/index": sync({
    kind: "constant",
    value: { mode: "offline" } satisfies HomeOfflineLoaderData,
  }),

  "routes/downloads": asyncFn(async () => {
    const storage = getOfflineStorage();
    const [tracks, stats] = await Promise.all([
      storage.listDownloaded(),
      storage.getStorageStats(),
    ]);
    return { tracks, stats } satisfies DownloadsOfflineLoaderData;
  }),

  "routes/library.index": asyncFn(async () => {
    const storage = getOfflineStorage();
    return {
      offline: true as const,
      offlineTracks: await storage.listPinned(),
      userTracks: [],
      pagination: { limit: LIBRARY_TRACKS_PAGE_SIZE, hasNext: false, nextCursor: null },
      hasAudioOnly: false,
      playlists: [],
    } satisfies LibraryOfflineLoaderData;
  }),

  "routes/playlists": sync({ kind: "constant", value: {} }),

  "routes/playlists.new": sync({ kind: "constant", value: {} }),

  "routes/playlists.index": asyncFn(async () => {
    const storage = getOfflineStorage();
    const cachedPlaylists = listCachedPlaylists();
    const offlinePlaylists = await Promise.all(
      cachedPlaylists.map(async (playlist) => ({
        ...playlist,
        trackCount: (await storage.listForPlaylist(playlist.id)).length,
      })),
    );
    return {
      offline: true as const,
      offlinePlaylists,
      playlists: [],
      pagination: { limit: 12, hasNext: false, nextCursor: null },
    } satisfies PlaylistsIndexOfflineLoaderData;
  }),

  "routes/playlists.$playlistId": asyncFn(async ({ params }) => {
    const playlistId = params.playlistId;
    if (!playlistId) throw new Response("Playlist not found", { status: 404 });
    const storage = getOfflineStorage();
    const offlineTracks = await storage.listForPlaylist(playlistId);
    const cachedMeta = getCachedPlaylistMetadata(playlistId);
    return {
      offline: true as const,
      offlineTracks,
      offlinePlaylistMeta: cachedMeta ?? {
        id: playlistId,
        title: "Offline playlist",
        description: null,
        updatedAt: Date.now(),
      },
      playlist: null,
      playlists: [],
    } satisfies PlaylistDetailOfflineLoaderData;
  }),

  // ── Stub routes (unchanged) ──

  "routes/search": sync({ kind: "constant", value: OFFLINE_SEARCH }),

  "routes/music+/services+/index": sync({
    kind: "constant",
    value: OFFLINE_MUSIC_SERVICES,
  }),

  "routes/library.$trackId": sync({
    kind: "pathname",
    segmentIndex: 2,
    fn: offlineTrackDetailFallback,
  }),

  "routes/admin+/audio-queue": sync({
    kind: "constant",
    value: OFFLINE_ADMIN_AUDIO_QUEUE,
  }),

  "routes/music+/services+/youtube+/index": sync({
    kind: "constant",
    value: OFFLINE_YOUTUBE_INDEX,
  }),

  "routes/music+/services+/youtube+/playlists": sync({
    kind: "constant",
    value: OFFLINE_YOUTUBE_PLAYLISTS,
  }),

  "routes/music+/services+/youtube+/synced-playlists": sync({
    kind: "constant",
    value: OFFLINE_YOUTUBE_SYNCED,
  }),

  "routes/music+/services+/youtube+/playlist.$id": sync({
    kind: "pathname",
    segmentIndex: 5,
    fn: offlineYoutubePlaylistFallback,
  }),

  "routes/settings+/profile.passkeys": sync({
    kind: "constant",
    value: OFFLINE_PASSKEYS,
  }),
};

// ── Param index maps for routes that need dynamic params ─────────────────────
// Segment index → param name. Used by pathname-based and async stubs.

const ROUTE_PARAM_MAPS: Record<string, Record<number, string>> = {
  "routes/playlists.$playlistId": { 2: "playlistId" },
  "routes/library.$trackId": { 2: "trackId" },
  "routes/music+/services+/youtube+/playlist.$id": { 5: "id" },
};

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve offline stub data for a given route.
 * Called by the middleware when patching data strategy results offline.
 */
export async function resolveOfflineData(routeId: string, request: Request): Promise<unknown> {
  const entry = OFFLINE_ROUTE_POLICIES[routeId];

  if (!entry) {
    // No policy → return empty if not in skip list
    return OFFLINE_MIDDLEWARE_SKIP_PREFIXES.some((p) => routeId.startsWith(p))
      ? undefined // shouldn't happen, but skip means don't touch
      : OFFLINE_EMPTY;
  }

  if (entry.kind === "sync") {
    return resolveSyncStub(entry.value, routeId, request.url);
  }

  // async stub
  const paramMap = ROUTE_PARAM_MAPS[routeId] ?? {};
  const params = paramsFromSegments(request.url, paramMap);
  return entry.fn({ request, params });
}

function resolveSyncStub(stub: OfflineStubValue, routeId: string, url: string): unknown {
  if (stub.kind === "empty") return OFFLINE_EMPTY;
  if (stub.kind === "constant") return stub.value;
  // pathname kind — extract segment and call fn
  const segment = segmentAt(url, stub.segmentIndex);
  return stub.fn(segment);
}

/**
 * Check whether a route should be skipped by the offline middleware.
 * Routes in the skip list (API, resource, auth) are never patched.
 */
export function shouldSkipOfflineMiddlewareRoute(routeId: string): boolean {
  return OFFLINE_MIDDLEWARE_SKIP_PREFIXES.some((prefix) => routeId.startsWith(prefix));
}

/** Get the offline redirect target for a URL path, if any. */
export function getOfflineRedirectTarget(request: Request): string | undefined {
  const pathname = new URL(request.url).pathname;
  return OFFLINE_REDIRECTS.find((entry) => entry.matchPathname(pathname))?.to;
}
