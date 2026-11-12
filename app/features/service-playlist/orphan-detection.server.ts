import { logGoogleApiError } from "#app/utils/google-api-error-logger.server.ts";
import {
  classifyAbsentPlaylistTracks,
  isYouTubeVideoId,
  type AbsentPlaylistTrackRow,
  type VideoExistenceLookup,
} from "./absent-track-classification.server";
import type { ProcessedIdSets, SyncableItem } from "./batch-processor.server";
import { type ResolveVideoExistence } from "./playlist-sync-provider.server";
import { findAllServicePlaylistTracks } from "./service-playlist-track-queries.server";

/**
 * Pending match for deleted videos that need user confirmation.
 */
export interface PendingMatch {
  deletedVideo: {
    position: number;
    itemId: string | undefined;
    title: string | undefined;
    snippet: SyncableItem["snippet"];
  };
  candidateTracks: Array<{
    id: string;
    title: string;
    artist: string;
    externalId: string | null;
    position: number;
    isDeleted: boolean;
  }>;
}

/**
 * Deleted/unavailable playlist item that did not match an existing Track by id.
 * Resolved after the full sync against playlist-scoped orphans.
 */
export interface DeletedVideoWithoutMatch {
  position: number;
  itemId: string | undefined;
  title: string | undefined;
  snippet: SyncableItem["snippet"];
  externalId: string;
}

export type OrphanCandidate = PendingMatch["candidateTracks"][number];

export type PlaylistTrackForOrphanDetection = {
  id: string;
  track: {
    id: string;
    title: string;
    artist: { id: string; name: string } | null;
    externalId: string | null;
  };
  position: number;
  isDeleted: boolean;
};

export const ORPHAN_DETECTION_INCLUDE = {
  track: {
    select: {
      id: true,
      title: true,
      artist: {
        select: {
          id: true,
          name: true,
        },
      },
      externalId: true,
    },
  },
} as const;

/**
 * Tracks in the playlist that are not present in the completed sync response.
 * Candidates for matching with deleted/unavailable YouTube items.
 */
export function filterOrphanedTracks(
  allPlaylistTracks: PlaylistTrackForOrphanDetection[],
  processedIds: ProcessedIdSets,
): OrphanCandidate[] {
  return filterAbsentPlaylistTracks(allPlaylistTracks, processedIds).map((track) => ({
    id: track.trackId,
    title: track.title,
    artist: track.artist,
    externalId: track.externalId,
    position: track.position,
    isDeleted: track.isDeleted,
  }));
}

/**
 * Absent non-deleted playlist memberships (SPT-level), for videos.list classification.
 */
export function filterAbsentPlaylistTracks(
  allPlaylistTracks: PlaylistTrackForOrphanDetection[],
  processedIds: ProcessedIdSets,
): AbsentPlaylistTrackRow[] {
  return allPlaylistTracks
    .filter((playlistTrack) => {
      const externalId = playlistTrack.track.externalId;
      const trackId = playlistTrack.track.id;

      if (externalId && processedIds.externalIds.has(externalId)) return false;
      if (processedIds.trackIds.has(trackId)) return false;
      if (playlistTrack.isDeleted) return false;

      return true;
    })
    .map((playlistTrack) => ({
      sptId: playlistTrack.id,
      trackId: playlistTrack.track.id,
      title: playlistTrack.track.title,
      artist: playlistTrack.track.artist?.name || "Unknown Artist",
      externalId: playlistTrack.track.externalId,
      position: playlistTrack.position,
      isDeleted: playlistTrack.isDeleted,
    }));
}

/**
 * Unclaimed rows of a track the sync DID see (duplicate copies no longer in the
 * payload). Claimed rows == payload items for that video, so removing only the
 * unclaimed ones never drops below the payload's item count for the video.
 */
export function findSurplusSptIds(
  allPlaylistTracks: PlaylistTrackForOrphanDetection[],
  processedIds: ProcessedIdSets,
): Set<string> {
  const surplus = new Set<string>();
  for (const playlistTrack of allPlaylistTracks) {
    if (processedIds.sptIds.has(playlistTrack.id)) continue;
    if (!processedIds.trackIds.has(playlistTrack.track.id)) continue;
    // A copy whose preparation failed is unclaimed but not surplus.
    const extId = playlistTrack.track.externalId;
    if (extId && processedIds.failedExternalIds?.has(extId)) continue;
    surplus.add(playlistTrack.id);
  }
  return surplus;
}

export async function lookupVideoExistence(
  absentTracks: AbsentPlaylistTrackRow[],
  accessToken: string | undefined,
  resolveVideoExistence: ResolveVideoExistence | undefined,
): Promise<VideoExistenceLookup | "no-probe"> {
  if (!resolveVideoExistence || !accessToken) {
    return "no-probe";
  }

  const idsToProbe = [
    ...new Set(
      absentTracks.map((t) => t.externalId).filter((id): id is string => isYouTubeVideoId(id)),
    ),
  ];

  if (idsToProbe.length === 0) {
    return { status: "ok", existingIds: new Set() };
  }

  try {
    const existingIds = await resolveVideoExistence(idsToProbe, accessToken);
    return { status: "ok", existingIds };
  } catch (error) {
    logGoogleApiError("Failed to resolve video existence during playlist sync", error);
    return { status: "error" };
  }
}

export function classifyWithoutProbe(
  absentTracks: AbsentPlaylistTrackRow[],
  hasDeferredDeletedItems: boolean,
): ReturnType<typeof classifyAbsentPlaylistTracks> {
  if (hasDeferredDeletedItems) {
    return {
      removeSptIds: new Set(),
      leaveAloneSptIds: new Set(),
      candidateTracks: absentTracks.map((track) => ({
        id: track.trackId,
        title: track.title,
        artist: track.artist,
        externalId: track.externalId,
        position: track.position,
        isDeleted: track.isDeleted,
      })),
    };
  }

  return {
    removeSptIds: new Set(absentTracks.map((t) => t.sptId)),
    leaveAloneSptIds: new Set(),
    candidateTracks: [],
  };
}

/**
 * Build pending matches only when orphan candidates exist.
 * Every deleted video shares the same candidate pool (uniqueness enforced at confirm time).
 */
export function buildPendingMatches(
  deletedVideos: DeletedVideoWithoutMatch[],
  orphanCandidates: OrphanCandidate[],
): PendingMatch[] {
  if (deletedVideos.length === 0 || orphanCandidates.length === 0) {
    return [];
  }

  return deletedVideos.map((deletedVideo) => ({
    deletedVideo: {
      position: deletedVideo.position,
      itemId: deletedVideo.itemId,
      title: deletedVideo.title,
      snippet: deletedVideo.snippet,
    },
    candidateTracks: orphanCandidates,
  }));
}

export async function loadPlaylistTracksForOrphanDetection(
  db: Parameters<typeof findAllServicePlaylistTracks>[0],
  playlistId: string,
): Promise<PlaylistTrackForOrphanDetection[]> {
  const allPlaylistTracks = await findAllServicePlaylistTracks(db, {
    where: { playlistId },
    include: ORPHAN_DETECTION_INCLUDE,
  });
  return [...allPlaylistTracks].sort((a, b) => a.position - b.position);
}
