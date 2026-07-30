import {
  getCachedPlaylistMetadata,
  listCachedPlaylists,
  type CachedPlaylistMeta,
} from "#app/features/offline-storage/offline-playlist-metadata.client.ts";
import { getOfflineStorage } from "#app/features/offline-storage/offline-storage.client.ts";
import { type OfflineTrackSummary } from "#app/features/offline-storage/types.ts";
import { LIBRARY_TRACKS_PAGE_SIZE } from "#app/utils/library-tracks-pagination.ts";
import {
  createFallbackOfflineRootShell,
  persistOfflineRootShell,
  type OfflineRootShell,
} from "./offline-root-shell.client.ts";
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

export type OfflineClientLoaderArgs = {
  serverLoader: () => Promise<unknown>;
  params: Record<string, string | undefined>;
  request: Request;
};

export type OfflineStubValue =
  | { kind: "empty" }
  | { kind: "constant"; value: unknown }
  | {
      kind: "pathname";
      segmentIndex: number;
      fn: (value: string) => unknown;
    };

export type OfflineLiveRoutePolicy = {
  mode: "live";
  offlineLoader: (args: OfflineClientLoaderArgs) => Promise<unknown>;
  onlineLoader?: (args: OfflineClientLoaderArgs) => Promise<unknown>;
};

export type OfflineStubRoutePolicy = {
  mode: "stub";
  stub: OfflineStubValue;
};

export type OfflineRoutePolicy = OfflineLiveRoutePolicy | OfflineStubRoutePolicy;

export const OFFLINE_MIDDLEWARE_SKIP_PREFIXES = [
  "routes/resources+/",
  "routes/api+/",
  "routes/_auth+/",
];

export const OFFLINE_REDIRECTS: Array<{
  matchPathname: (pathname: string) => boolean;
  to: string;
}> = [{ matchPathname: (pathname) => pathname === "/me", to: "/downloads" }];

export const OFFLINE_ROUTE_POLICIES: Record<string, OfflineRoutePolicy> = {
  root: {
    mode: "live",
    onlineLoader: async ({ serverLoader }) => {
      const shell = (await serverLoader()) as OfflineRootShell;
      persistOfflineRootShell({
        user: shell.user,
        requestInfo: {
          ...shell.requestInfo,
          userPrefs: {
            theme: shell.requestInfo.userPrefs.theme ?? "light",
          },
        },
        ENV: shell.ENV,
      });
      return shell;
    },
    offlineLoader: async () => createFallbackOfflineRootShell(),
  },
  "routes/_marketing+/index": {
    mode: "live",
    offlineLoader: async (): Promise<HomeOfflineLoaderData> => ({
      mode: "offline" as const,
    }),
  },
  "routes/library.index": {
    mode: "live",
    offlineLoader: async (): Promise<LibraryOfflineLoaderData> => {
      const storage = getOfflineStorage();
      return {
        offline: true as const,
        offlineTracks: await storage.listPinned(),
        userTracks: [],
        pagination: {
          limit: LIBRARY_TRACKS_PAGE_SIZE,
          hasNext: false,
          nextCursor: null,
        },
        hasAudioOnly: false,
        playlists: [],
      };
    },
  },
  "routes/downloads": {
    mode: "live",
    offlineLoader: async (): Promise<DownloadsOfflineLoaderData> => {
      const storage = getOfflineStorage();
      const [tracks, stats] = await Promise.all([
        storage.listDownloaded(),
        storage.getStorageStats(),
      ]);
      return { tracks, stats };
    },
  },
  "routes/playlists": { mode: "live", offlineLoader: async () => ({}) },
  "routes/playlists.index": {
    mode: "live",
    offlineLoader: async (): Promise<PlaylistsIndexOfflineLoaderData> => {
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
      };
    },
  },
  "routes/playlists.new": { mode: "live", offlineLoader: async () => ({}) },
  "routes/playlists.$playlistId": {
    mode: "live",
    offlineLoader: async ({ params }): Promise<PlaylistDetailOfflineLoaderData> => {
      const playlistId = params.playlistId;
      if (!playlistId) {
        throw new Response("Playlist not found", { status: 404 });
      }

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
      };
    },
  },
  "routes/search": {
    mode: "stub",
    stub: { kind: "constant", value: OFFLINE_SEARCH },
  },
  "routes/music+/services+/index": {
    mode: "stub",
    stub: { kind: "constant", value: OFFLINE_MUSIC_SERVICES },
  },
  "routes/library.$trackId": {
    mode: "stub",
    stub: {
      kind: "pathname",
      segmentIndex: 2,
      fn: offlineTrackDetailFallback,
    },
  },
  "routes/admin+/audio-queue": {
    mode: "stub",
    stub: { kind: "constant", value: OFFLINE_ADMIN_AUDIO_QUEUE },
  },
  "routes/music+/services+/youtube+/index": {
    mode: "stub",
    stub: { kind: "constant", value: OFFLINE_YOUTUBE_INDEX },
  },
  "routes/music+/services+/youtube+/playlists": {
    mode: "stub",
    stub: { kind: "constant", value: OFFLINE_YOUTUBE_PLAYLISTS },
  },
  "routes/music+/services+/youtube+/synced-playlists": {
    mode: "stub",
    stub: { kind: "constant", value: OFFLINE_YOUTUBE_SYNCED },
  },
  "routes/music+/services+/youtube+/playlist.$id": {
    mode: "stub",
    stub: {
      kind: "pathname",
      segmentIndex: 5,
      fn: offlineYoutubePlaylistFallback,
    },
  },
  "routes/settings+/profile.passkeys": {
    mode: "stub",
    stub: { kind: "constant", value: OFFLINE_PASSKEYS },
  },
};

export function isLiveOfflineRoute(routeId: string) {
  const policy = OFFLINE_ROUTE_POLICIES[routeId];
  return policy?.mode === "live";
}

export function shouldSkipOfflineMiddlewareRoute(routeId: string) {
  if (isLiveOfflineRoute(routeId)) return true;
  return OFFLINE_MIDDLEWARE_SKIP_PREFIXES.some((prefix) => routeId.startsWith(prefix));
}

export function resolveOfflineStubForRoute(routeId: string, request: Request) {
  const policy = OFFLINE_ROUTE_POLICIES[routeId];
  if (!policy || policy.mode !== "stub") return OFFLINE_EMPTY;

  const stub = policy.stub;
  if (stub.kind === "empty") return OFFLINE_EMPTY;
  if (stub.kind === "constant") return stub.value;

  const segment = new URL(request.url).pathname.split("/").at(stub.segmentIndex) ?? "";
  return stub.fn(segment);
}

export function getOfflineRedirectTarget(request: Request) {
  const pathname = new URL(request.url).pathname;
  return OFFLINE_REDIRECTS.find((entry) => entry.matchPathname(pathname))?.to;
}
