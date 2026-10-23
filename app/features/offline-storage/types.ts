import { type FullTrack } from "#app/types/frontend/shared";

export const OFFLINE_DB_NAME = "music-library-offline";
export const OFFLINE_DB_VERSION = 2;
export const OFFLINE_TRACKS_STORE = "tracks";
export const OFFLINE_COVERS_STORE = "covers";

export type OfflineTrackRecord = {
  trackId: string;
  title: string;
  artistId: string;
  artistName: string;
  duration: number | null;
  coverObjectKey: string | null;
  opfsPath: string;
  audioFormat: string | null;
  /** True when the user tapped download (track or playlist bulk). */
  isPinned: boolean;
  /** True when auto-cached from the active queue. */
  isQueueCached: boolean;
  fileSizeBytes: number;
  lastAccessedAt: number;
  pinnedAt: number | null;
  playlistIds: string[];
};

export type OfflineTrackSummary = Pick<
  OfflineTrackRecord,
  | "trackId"
  | "title"
  | "artistId"
  | "artistName"
  | "duration"
  | "coverObjectKey"
  | "audioFormat"
  | "isPinned"
  | "isQueueCached"
  | "fileSizeBytes"
  | "lastAccessedAt"
>;

export function toOfflineTrackRecord(
  track: FullTrack,
  options: {
    opfsPath: string;
    fileSizeBytes: number;
    isPinned: boolean;
    isQueueCached: boolean;
    playlistId?: string;
    audioFormat?: string | null;
  },
): OfflineTrackRecord {
  const now = Date.now();
  const playlistIds = options.playlistId ? [options.playlistId] : [];

  return {
    trackId: track.id,
    title: track.title,
    artistId: track.artist.id,
    artistName: track.artist.name,
    duration: track.duration,
    coverObjectKey: track.coverImage?.objectKey ?? null,
    opfsPath: options.opfsPath,
    audioFormat: options.audioFormat ?? null,
    isPinned: options.isPinned,
    isQueueCached: options.isQueueCached,
    fileSizeBytes: options.fileSizeBytes,
    lastAccessedAt: now,
    pinnedAt: options.isPinned ? now : null,
    playlistIds,
  };
}

export function mergeOfflineTrackRecord(
  existing: OfflineTrackRecord,
  update: Partial<
    Pick<
      OfflineTrackRecord,
      "isPinned" | "isQueueCached" | "fileSizeBytes" | "lastAccessedAt" | "pinnedAt" | "audioFormat"
    >
  > & { playlistId?: string },
): OfflineTrackRecord {
  // `playlistId` is a transient merge input, not a stored field. Destructure it
  // out so the `...rest` spread can't leak it onto the record alongside
  // `playlistIds`.
  const { playlistId, ...rest } = update;
  const playlistIds = playlistId
    ? [...new Set([...existing.playlistIds, playlistId])]
    : existing.playlistIds;

  return {
    ...existing,
    ...rest,
    isPinned: rest.isPinned ?? existing.isPinned,
    isQueueCached: rest.isQueueCached ?? existing.isQueueCached,
    pinnedAt:
      rest.pinnedAt ?? (rest.isPinned && !existing.isPinned ? Date.now() : existing.pinnedAt),
    playlistIds,
  };
}
