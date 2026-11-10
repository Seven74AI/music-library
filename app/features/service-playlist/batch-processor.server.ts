import { pickCoverThumbnailUrl } from "#app/types/transformations";
import { getOrCreateArtistTx } from "#app/utils/artist-management.server";
import { prisma } from "#app/utils/db.server";
import { logGoogleApiError } from "#app/utils/google-api-error-logger.server.ts";
import { type Prisma } from "#prisma/client.js";
import {
  classifyAbsentPlaylistTracks,
  isYouTubeVideoId,
  type AbsentPlaylistTrackRow,
  type VideoExistenceLookup,
} from "./absent-track-classification.server";
import { type ArchiveEnqueueAdapter } from "./archive-enqueue-adapter.server";
import { type ResolveVideoExistence } from "./playlist-sync-provider.server";
import { findAllServicePlaylistTracks } from "./service-playlist-track-queries.server";
import {
  isSyntheticUnavailableExternalIdForPlaylist,
  planUnavailableItemProcessing,
} from "./unavailable-item-plan.server";
import { type TrackSyncProcessor } from "./youtube-track-sync.server";

/**
 * Generic syncable item — normalized track data from any provider.
 *
 * Providers (YouTube, Spotify, etc.) pass their items through this shape.
 * The batch processor does NOT depend on YouTube-specific types;
 * it only accesses the fields defined here.
 */
export interface SyncableItem {
  id?: string;
  snippet?: {
    title?: string;
    resourceId?: { videoId?: string };
    videoOwnerChannelTitle?: string;
    channelTitle?: string;
    thumbnails?: {
      maxres?: { url?: string };
      medium?: { url?: string };
      default?: { url?: string };
    };
  };
}

/**
 * Batch data structure for processing tracks in batches.
 * Used for efficient database operations during playlist sync.
 */
export interface TrackDataBatch<TItem extends SyncableItem = SyncableItem> {
  serviceId: string;
  externalId: string;
  trackData: Omit<
    ReturnType<TrackSyncProcessor["transformPlaylistItem"]>,
    "thumbnailUrl" | "service" | "externalId"
  > & { serviceId: string; externalId: string; coverImageId?: string | null };
  position: number;
  item: TItem;
}

/**
 * Track information for sync reporting.
 */
export interface SyncTrackInfo {
  id: string;
  title: string;
  externalId?: string;
  /** ServicePlaylistTrack row id (per-membership key; a video may have several rows). */
  membershipId?: string;
}

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

/**
 * External IDs and track IDs seen during a completed (or in-progress) sync.
 * Always travel together for orphan filtering and removal detection.
 */
export type ProcessedIdSets = {
  externalIds: Set<string>;
  trackIds: Set<string>;
  /** ServicePlaylistTrack row ids claimed by a payload item (accumulated across batches). */
  sptIds: Set<string>;
  /** externalIds whose preparation failed: never treated as removal or surplus. */
  failedExternalIds?: Set<string>;
};

/**
 * Result from processing tracks in batches.
 */
export interface ProcessTracksResult {
  processedCount: number;
  deletedTracks: SyncTrackInfo[];
  processedIds: ProcessedIdSets;
  pendingMatches: PendingMatch[];
  deletedVideosWithoutMatch: DeletedVideoWithoutMatch[];
  /** ServicePlaylistTrack ids classified for deletion this sync. */
  removeSptIds: Set<string>;
  /** ServicePlaylistTrack ids left untouched (lookup failure / non-probeable). */
  leaveAloneSptIds: Set<string>;
  /** Call scheduleArchiveQueueTickAfterCommit after the transaction commits. */
  archiveQueueTickNeeded: boolean;
}

type PlaylistTrackForOrphanDetection = {
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

const ORPHAN_DETECTION_INCLUDE = {
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

async function lookupVideoExistence(
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

function classifyWithoutProbe(
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

/**
 * After all sync batches: classify absences (optional videos.list), open pending
 * matches or auto-create "Deleted video" tracks (ADR-005 first-sync fallback).
 */
export async function resolveDeletedVideosAfterSync(
  playlistId: string,
  serviceId: string,
  deletedVideosWithoutMatch: DeletedVideoWithoutMatch[],
  processedIds: ProcessedIdSets,
  options?: {
    accessToken?: string;
    resolveVideoExistence?: ResolveVideoExistence;
  },
): Promise<{
  pendingMatches: PendingMatch[];
  autoCreatedCount: number;
  deletedTracks: SyncTrackInfo[];
  processedIds: ProcessedIdSets;
  removeSptIds: Set<string>;
  leaveAloneSptIds: Set<string>;
}> {
  const allPlaylistTracks = await loadPlaylistTracksForOrphanDetection(prisma, playlistId);
  const absentTracks = filterAbsentPlaylistTracks(allPlaylistTracks, processedIds);
  const hasDeferredDeletedItems = deletedVideosWithoutMatch.length > 0;
  const surplusSptIds = findSurplusSptIds(allPlaylistTracks, processedIds);

  const lookup = await lookupVideoExistence(
    absentTracks,
    options?.accessToken,
    options?.resolveVideoExistence,
  );

  const classification =
    lookup === "no-probe"
      ? classifyWithoutProbe(absentTracks, hasDeferredDeletedItems)
      : classifyAbsentPlaylistTracks({
          absentTracks,
          lookup,
          hasDeferredDeletedItems,
        });

  if (!hasDeferredDeletedItems) {
    return {
      pendingMatches: [],
      autoCreatedCount: 0,
      deletedTracks: [],
      processedIds,
      removeSptIds: new Set([...classification.removeSptIds, ...surplusSptIds]),
      leaveAloneSptIds: classification.leaveAloneSptIds,
    };
  }

  if (classification.candidateTracks.length > 0) {
    return {
      pendingMatches: buildPendingMatches(
        deletedVideosWithoutMatch,
        classification.candidateTracks,
      ),
      autoCreatedCount: 0,
      deletedTracks: [],
      processedIds,
      removeSptIds: new Set([...classification.removeSptIds, ...surplusSptIds]),
      leaveAloneSptIds: classification.leaveAloneSptIds,
    };
  }

  const { createId } = await import("@paralleldrive/cuid2");
  const deletedTracks: SyncTrackInfo[] = [];
  const nextProcessedIds: ProcessedIdSets = {
    externalIds: processedIds.externalIds,
    trackIds: new Set(processedIds.trackIds),
    sptIds: new Set(processedIds.sptIds),
    failedExternalIds: processedIds.failedExternalIds,
  };

  await prisma.$transaction(async (tx) => {
    for (const deletedVideo of deletedVideosWithoutMatch) {
      const artistRecord = await getOrCreateArtistTx(tx, "Unknown Artist");
      const externalId = deletedVideo.externalId;

      // Upsert, not create: an itemId-less unavailable item re-synthesizes the same
      // `pending-{playlistId}-{position}` externalId on every sync, so a bare create
      // throws the serviceId_externalId unique-constraint violation on the second sync.
      const track = await tx.track.upsert({
        where: {
          serviceId_externalId: { serviceId, externalId },
        },
        // ADR-005: preserve existing title/artist on re-sync; only mark deletion on SPT.
        update: {},
        create: {
          id: createId(),
          title: "Deleted video",
          artistId: artistRecord.id,
          duration: null,
          externalId,
          serviceId,
          serviceUrl: null,
          releaseDate: null,
        },
      });

      // Keyed by the YouTube playlistItem.id; itemId-less items fall back to the
      // track-keyed row with a NULL playlistItemId (legacy behaviour).
      const itemId = deletedVideo.itemId ?? null;
      let existingSpt = null;
      if (itemId) {
        existingSpt = await tx.servicePlaylistTrack.findFirst({
          where: { playlistId, playlistItemId: itemId },
        });
      }
      if (!existingSpt) {
        existingSpt = await tx.servicePlaylistTrack.findFirst({
          where: {
            playlistId,
            trackId: track.id,
            playlistItemId: null,
            id: { notIn: [...nextProcessedIds.sptIds] },
          },
          orderBy: { createdAt: "asc" },
        });
      }
      const spt = existingSpt
        ? await tx.servicePlaylistTrack.update({
            where: { id: existingSpt.id },
            data: {
              position: deletedVideo.position,
              isDeleted: true,
              ...(itemId ? { playlistItemId: itemId } : {}),
            },
          })
        : await tx.servicePlaylistTrack.create({
            data: {
              id: createId(),
              playlistId,
              trackId: track.id,
              playlistItemId: itemId,
              position: deletedVideo.position,
              isDeleted: true,
              deletedAt: new Date(),
            },
          });

      nextProcessedIds.sptIds.add(spt.id);
      nextProcessedIds.trackIds.add(track.id);
      deletedTracks.push({
        id: track.id,
        title: "Deleted video",
        externalId,
        membershipId: spt.id,
      });
    }
  });

  return {
    pendingMatches: [],
    autoCreatedCount: deletedTracks.length,
    deletedTracks,
    processedIds: nextProcessedIds,
    removeSptIds: new Set([...classification.removeSptIds, ...surplusSptIds]),
    leaveAloneSptIds: classification.leaveAloneSptIds,
  };
}

/**
 * Process tracks in batches for better performance.
 * Images should be pre-downloaded and passed in to avoid transaction timeouts.
 *
 * Standalone function — moved from ServicePlaylistService facade.
 *
 * @param playlistItems - Array of playlist items to process
 * @param serviceId - The service ID
 * @param playlistId - The playlist ID
 * @param tx - Prisma transaction instance
 * @param trackProcessor - Service-specific track sync logic
 * @param archiveEnqueueAdapter - Injected archive enqueue seam
 * @param globalStartPosition - Starting position offset (for paginated batches)
 * @param accumulatedProcessedIds - IDs already processed in prior batches
 * @returns Result with processed count, deleted tracks, and processed IDs
 */
export async function processTracksInBatches<TItem extends SyncableItem>(
  playlistItems: TItem[],
  serviceId: string,
  playlistId: string,
  tx: Prisma.TransactionClient,
  trackProcessor: TrackSyncProcessor,
  archiveEnqueueAdapter: ArchiveEnqueueAdapter,
  globalStartPosition: number = 0,
  accumulatedProcessedIds?: ProcessedIdSets,
): Promise<ProcessTracksResult> {
  let processedTracks = 0;
  let archiveQueueTickNeeded = false;
  const batchSize = 50;
  const deletedTracks: SyncTrackInfo[] = [];
  // Merge accumulated sets with new sets to track all processed items across batches
  const processedIds: ProcessedIdSets = {
    externalIds: new Set<string>(accumulatedProcessedIds?.externalIds || []),
    trackIds: new Set<string>(accumulatedProcessedIds?.trackIds || []),
    sptIds: new Set<string>(accumulatedProcessedIds?.sptIds || []),
    failedExternalIds: new Set<string>(accumulatedProcessedIds?.failedExternalIds || []),
  };
  const deletedVideosWithoutMatch: DeletedVideoWithoutMatch[] = [];

  for (let batchStart = 0; batchStart < playlistItems.length; batchStart += batchSize) {
    const batch = playlistItems.slice(batchStart, batchStart + batchSize);

    // Prepare batch data
    const trackDataBatch: TrackDataBatch<TItem>[] = [];
    // Collect deleted videos without matches for post-sync resolution
    const batchDeletedWithoutMatch: Array<{
      item: TItem;
      position: number;
      externalId: string;
    }> = [];

    // FIRST PASS: Process all items in the batch

    // Pre-load existing tracks for the whole batch in a single findMany instead
    // of issuing up to two findUnique lookups per item (N+1 pattern).
    type ExistingTrackRow = {
      id: string;
      title: string;
      artistId: string;
      albumId: string | null;
      releaseDate: Date | null;
      duration: number | null;
      coverImageId: string | null;
      externalId: string | null;
      hasTrackAudioFile: boolean;
    };

    const trackSelect = {
      id: true,
      title: true,
      artistId: true,
      albumId: true,
      releaseDate: true,
      duration: true,
      coverImageId: true,
      externalId: true,
      audioFiles: { select: { id: true }, take: 1 },
    } as const;

    const candidateKeys = new Set<string>();
    for (let i = 0; i < batch.length; i++) {
      const item = batch[i];
      if (!item) continue;
      const videoId = item.snippet?.resourceId?.videoId || "";
      const position = globalStartPosition + batchStart + i + 1;
      const isUnavailable = trackProcessor.isUnavailableVideo(item);
      if (isUnavailable && item.id) candidateKeys.add(item.id);
      if (videoId) candidateKeys.add(videoId);
      if (isUnavailable && !item.id && !videoId) {
        candidateKeys.add(`pending-${playlistId}-${position}`);
      }
    }

    const batchPositions: number[] = [];
    for (let i = 0; i < batch.length; i++) {
      batchPositions.push(globalStartPosition + batchStart + i + 1);
    }

    const existingTracksByPlaylistPosition = new Map<number, ExistingTrackRow>();
    if (batchPositions.length > 0) {
      const sptRows = await tx.servicePlaylistTrack.findMany({
        where: { playlistId, position: { in: batchPositions } },
        select: {
          position: true,
          track: { select: trackSelect },
        },
      });
      for (const row of sptRows) {
        const track = row.track;
        if (!track?.externalId) continue;
        const audioFiles = Array.isArray(track.audioFiles) ? track.audioFiles : [];
        const { audioFiles: _audioFiles, ...base } = track;
        existingTracksByPlaylistPosition.set(row.position, {
          ...base,
          hasTrackAudioFile: audioFiles.length > 0,
        });
      }
    }

    const existingTracksByExternalId = new Map<string, ExistingTrackRow>();
    if (candidateKeys.size > 0) {
      const found = await tx.track.findMany({
        where: {
          serviceId,
          externalId: { in: [...candidateKeys] },
        },
        select: trackSelect,
      });
      for (const row of found) {
        if (!row.externalId) continue;
        const audioFiles = Array.isArray(row.audioFiles) ? row.audioFiles : [];
        const hasTrackAudioFile = audioFiles.length > 0;
        const { audioFiles: _audioFiles, ...base } = row;
        existingTracksByExternalId.set(row.externalId, {
          ...base,
          hasTrackAudioFile,
        });
      }
    }

    for (let i = 0; i < batch.length; i++) {
      const item = batch[i] as TItem;
      if (!item) continue;

      const videoId = item.snippet?.resourceId?.videoId || "";
      const position = globalStartPosition + batchStart + i + 1;
      const isUnavailable = trackProcessor.isUnavailableVideo(item);

      // Try to find existing track by stable identifiers
      let existingTrack: ExistingTrackRow | null = null;

      // First, try matching by playlist item ID (for deleted videos)
      if (isUnavailable && item.id) {
        existingTrack = existingTracksByExternalId.get(item.id) ?? null;
      }

      // If not found, try matching by videoId (externalId)
      if (!existingTrack && videoId) {
        existingTrack = existingTracksByExternalId.get(videoId) ?? null;
      }

      if (isUnavailable && !existingTrack && !item.id && !videoId) {
        const positionHit = existingTracksByPlaylistPosition.get(position) ?? null;
        if (
          positionHit?.externalId &&
          isSyntheticUnavailableExternalIdForPlaylist(positionHit.externalId, playlistId)
        ) {
          existingTrack = positionHit;
        }
        if (!existingTrack) {
          const pendingKey = `pending-${playlistId}-${position}`;
          existingTrack = existingTracksByExternalId.get(pendingKey) ?? null;
        }
      }

      const plan = planUnavailableItemProcessing({
        isUnavailable,
        itemId: item.id,
        videoId,
        playlistId,
        position,
        existingTrack,
      });

      if (plan.kind === "skip") {
        console.warn(
          `Skipping track without externalId at position ${position}: ${item.snippet?.title || "Unknown"}`,
        );
        continue;
      }

      if (plan.kind === "defer") {
        batchDeletedWithoutMatch.push({
          item,
          position,
          externalId: plan.externalId,
        });
        // Mark externalId as processed to prevent it from being marked as "removed"
        // before post-sync orphan resolution / auto-create
        processedIds.externalIds.add(plan.externalId);
        continue;
      }

      const externalId = plan.externalId;
      existingTrack = plan.existingTrack;

      // Seen in this sync's API payload. Mark before ingest so a preparation
      // error cannot classify the membership as "removed from the playlist".
      processedIds.externalIds.add(externalId);

      try {
        // Get or create artist.
        // videoOwnerChannelTitle = the channel that uploaded the video (the artist).
        // snippet.channelTitle on a playlistItem is the PLAYLIST owner's channel —
        // never use it as the artist name.
        const artistName = item.snippet?.videoOwnerChannelTitle || "Unknown Artist";
        const artistRecord = await getOrCreateArtistTx(tx, artistName);

        // Determine if we should preserve existing track data
        const preserveData = trackProcessor.shouldPreserveTrackData(existingTrack, item);

        // Skip image processing during sync - will be processed in background
        // Preserve existing coverImageId if available, otherwise set to null
        const coverImageId: string | null =
          preserveData && existingTrack?.coverImageId ? existingTrack.coverImageId : null;

        let trackData: Omit<
          ReturnType<TrackSyncProcessor["transformPlaylistItem"]>,
          "thumbnailUrl" | "service" | "externalId"
        > & {
          serviceId: string;
          externalId: string;
          coverImageId?: string | null;
        };

        if (preserveData && existingTrack) {
          // Preserve existing data, only update non-critical fields
          // Use existing artistId if preserving data
          const transformed = trackProcessor.transformPlaylistItem(
            item,
            serviceId,
            existingTrack.artistId,
          );
          const { thumbnailUrl: _, externalId: ___, ...rest } = transformed;
          trackData = existingTrack.hasTrackAudioFile
            ? {
                serviceUrl: rest.serviceUrl,
                serviceId,
                externalId,
                title: existingTrack.title,
                artistId: existingTrack.artistId,
                albumId: existingTrack.albumId,
                releaseDate: existingTrack.releaseDate,
                duration: existingTrack.duration,
                coverImageId: coverImageId || existingTrack.coverImageId || null,
              }
            : {
                ...rest,
                serviceId,
                title: existingTrack.title,
                artistId: existingTrack.artistId,
                coverImageId: coverImageId || existingTrack.coverImageId || null,
                externalId,
              };
        } else {
          const transformed = trackProcessor.transformPlaylistItem(
            item,
            serviceId,
            artistRecord.id,
          );
          const { thumbnailUrl: _, externalId: transformedExternalId, ...rest } = transformed;
          trackData = {
            ...rest,
            serviceId, // Use serviceId directly instead of service relation
            coverImageId,
            externalId: transformedExternalId ?? externalId,
          };
        }

        trackDataBatch.push({
          serviceId,
          externalId,
          trackData,
          position, // Use the calculated position that includes globalStartPosition
          item,
        });
      } catch (error) {
        logGoogleApiError(
          `Error preparing track ${item.snippet?.resourceId?.videoId || "unknown"}:`,
          error,
        );
        // externalId stays in processedIds so a failed preparation is not treated as removal;
        // also recorded so a sibling copy's unclaimed row is not deleted as surplus.
        processedIds.failedExternalIds?.add(externalId);
      }
    }

    // Batch upsert tracks — pair each upserted track with its source row so a
    // filtered middle entry cannot shift positions/deletion flags onto the wrong track.
    const validTrackEntries = trackDataBatch.filter(({ serviceId: sid, trackData: td }) => {
      const eid = td.externalId;
      // Filter out any entries with invalid IDs (shouldn't happen, but safety check)
      if (!sid || typeof eid !== "string" || eid.trim() === "") {
        console.warn(`Skipping track upsert with invalid IDs: serviceId=${sid}, externalId=${eid}`);
        return false;
      }
      return true;
    });

    const pairedTrackUpserts = validTrackEntries.map(
      async ({ serviceId: sid, externalId: eid, trackData: td, position, item }) => {
        // Final validation: ensure both serviceId and externalId are non-empty strings
        // SQLite unique indexes on nullable columns require non-null, non-empty values for upsert
        if (!sid || !eid || sid.trim() === "" || eid.trim() === "") {
          console.error(`Invalid upsert parameters: serviceId="${sid}", externalId="${eid}"`);
          throw new Error(
            `Cannot upsert track: serviceId and externalId must be non-empty strings. Got serviceId="${sid}", externalId="${eid}"`,
          );
        }

        // Ensure trackData has the correct serviceId and externalId for the create clause
        // This is critical for SQLite unique constraint matching
        const createData = {
          ...td,
          serviceId: sid, // Explicitly set to ensure it matches the where clause
          externalId: eid, // Explicitly set to ensure it matches the where clause
        };

        // Validate createData has required fields
        if (
          !createData.serviceId ||
          !createData.externalId ||
          createData.serviceId.trim() === "" ||
          createData.externalId.trim() === ""
        ) {
          console.error(
            `Invalid createData: serviceId="${createData.serviceId}", externalId="${createData.externalId}"`,
          );
          throw new Error(
            `Cannot create track: createData must have non-empty serviceId and externalId`,
          );
        }

        const trackAtUpsert = await tx.track.findUnique({
          where: {
            serviceId_externalId: {
              serviceId: sid,
              externalId: eid,
            },
          },
          select: {
            title: true,
            artistId: true,
            albumId: true,
            releaseDate: true,
            duration: true,
            coverImageId: true,
            audioFiles: { select: { id: true }, take: 1 },
          },
        });

        const hasTrackAudioFileNow = trackAtUpsert !== null && trackAtUpsert.audioFiles.length > 0;

        const updateData: Prisma.TrackUncheckedUpdateInput = hasTrackAudioFileNow
          ? {
              serviceUrl: td.serviceUrl,
              serviceId: sid,
              externalId: eid,
              title: trackAtUpsert!.title,
              artistId: trackAtUpsert!.artistId,
              albumId: trackAtUpsert!.albumId,
              releaseDate: trackAtUpsert!.releaseDate,
              duration: trackAtUpsert!.duration,
              coverImageId: td.coverImageId ?? trackAtUpsert!.coverImageId,
              updatedAt: new Date(),
            }
          : (Object.fromEntries(
              Object.entries({
                ...td,
                serviceId: sid,
                externalId: eid,
                updatedAt: new Date(),
              }).filter(([, value]) => value !== null && value !== undefined),
            ) as Prisma.TrackUncheckedUpdateInput);

        const track = await tx.track.upsert({
          where: {
            serviceId_externalId: {
              serviceId: sid,
              externalId: eid,
            },
          },
          update: updateData,
          create: createData,
        });

        return {
          track,
          trackData: {
            serviceId: sid,
            externalId: eid,
            trackData: td,
            position,
            item,
          },
        };
      },
    );

    const pairedTracks = await Promise.all(pairedTrackUpserts);
    const tracks = pairedTracks.map((row) => row.track);

    // Auto-enqueue ArchiveJobs for tracks that have a serviceUrl
    // (external service tracks, e.g. YouTube — not local uploads)
    // Batched: one findMany + one createMany instead of N create() calls
    // that spam unique-constraint errors on re-syncs of large playlists.
    const enqueued = await archiveEnqueueAdapter.enqueueArchiveJobs(
      tx,
      tracks.filter((track) => track.serviceUrl).map((track) => track.id),
    );
    archiveQueueTickNeeded = archiveQueueTickNeeded || enqueued;

    // Pre-load existing membership rows for the batch, keyed by ROW id (a video may
    // legitimately appear at several positions → several rows per track).
    type ExistingSpt = {
      id: string;
      trackId: string;
      playlistItemId: string | null;
      isDeleted: boolean;
      deletedAt: Date | null;
    };
    const batchTrackIds = tracks.map((track) => track.id);
    const batchItemIds = pairedTracks
      .map(({ trackData }) => trackData.item?.id)
      .filter((id): id is string => typeof id === "string" && id !== "");
    const batchItemIdSet = new Set(batchItemIds);
    const existingRows: ExistingSpt[] =
      batchTrackIds.length > 0
        ? await tx.servicePlaylistTrack.findMany({
            where: {
              playlistId,
              OR: [
                { trackId: { in: batchTrackIds } },
                ...(batchItemIds.length > 0 ? [{ playlistItemId: { in: batchItemIds } }] : []),
              ],
            },
            select: {
              id: true,
              trackId: true,
              playlistItemId: true,
              isDeleted: true,
              deletedAt: true,
            },
            orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          })
        : [];
    const rowsByItemId = new Map<string, ExistingSpt>();
    const legacyRowsByTrackId = new Map<string, ExistingSpt[]>();
    for (const row of existingRows) {
      if (row.playlistItemId) {
        rowsByItemId.set(row.playlistItemId, row);
      } else {
        const list = legacyRowsByTrackId.get(row.trackId) ?? [];
        list.push(row);
        legacyRowsByTrackId.set(row.trackId, list);
      }
    }

    // Claim ONE row per item SYNCHRONOUSLY, before any write, so two copies of the
    // same video can never claim the same row: (a) row already stamped with this
    // playlistItem.id; (b) else an unclaimed legacy NULL row of the same track (lazy
    // backfill / regenerated item ids); (c) else create.
    // Rows claimed in earlier batches of this sync are off-limits.
    const claimedRowIds = new Set<string>(processedIds.sptIds);
    const seenItemIds = new Set<string>();
    const claims = pairedTracks
      .map(({ track, trackData }) => {
        const itemId = trackData.item?.id || null;
        let existing: ExistingSpt | undefined;
        if (itemId) {
          // Same playlistItem.id twice in one batch: the second copy is a repeat, not a new row.
          if (seenItemIds.has(itemId)) return null;
          seenItemIds.add(itemId);
          const byItem = rowsByItemId.get(itemId);
          if (byItem && claimedRowIds.has(byItem.id)) return null; // same item twice: skip
          if (byItem) existing = byItem;
        }
        if (!existing) {
          existing = (legacyRowsByTrackId.get(track.id) ?? []).find(
            (row) => !claimedRowIds.has(row.id),
          );
        }
        if (!existing && itemId) {
          // Item id regenerated by the provider (e.g. UI reorder): reuse an unclaimed
          // row of the same track rather than creating a duplicate.
          existing = existingRows.find(
            (row) =>
              row.trackId === track.id &&
              !claimedRowIds.has(row.id) &&
              !batchItemIdSet.has(row.playlistItemId ?? ""),
          );
        }
        if (existing) claimedRowIds.add(existing.id);
        return { track, trackData, itemId, existing };
      })
      .filter((claim): claim is NonNullable<typeof claim> => claim !== null);

    // Write claimed rows. Each claim targets a distinct row (or a create), so
    // concurrent execution is safe.
    const playlistTrackPromises = claims.map(async ({ track, trackData, itemId, existing }) => {
      // Use the item stored with trackData to avoid index mismatch when items are skipped
      const item = trackData.item;
      const isDeleted = item ? trackProcessor.isUnavailableVideo(item) : false;

      // Get thumbnailUrl from API response
      const thumbnailUrl = pickCoverThumbnailUrl(item?.snippet?.thumbnails);

      const shouldSetDeletedAt = isDeleted && !existing?.isDeleted;

      const result = existing
        ? await tx.servicePlaylistTrack.update({
            where: { id: existing.id },
            data: {
              position: trackData.position,
              isDeleted,
              deletedAt: shouldSetDeletedAt ? new Date() : isDeleted ? existing.deletedAt : null,
              thumbnailUrl, // Store thumbnail URL for background processing
              ...(itemId ? { playlistItemId: itemId } : {}),
            },
          })
        : await tx.servicePlaylistTrack.create({
            data: {
              playlistId: playlistId,
              trackId: track.id,
              playlistItemId: itemId,
              position: trackData.position,
              isDeleted,
              deletedAt: isDeleted ? new Date() : null,
              thumbnailUrl, // Store thumbnail URL for background processing
            },
          });

      // Track deleted videos for reporting - only report newly detected deletions
      if (shouldSetDeletedAt) {
        deletedTracks.push({
          id: track.id,
          title: track.title,
          externalId: trackData.externalId,
          membershipId: result.id,
        });
      }

      return result;
    });

    const playlistTrackResults = await Promise.all(playlistTrackPromises);
    const successfulResults = playlistTrackResults.filter(
      (result): result is NonNullable<typeof result> => result !== null,
    );

    // Track all successfully processed trackIds / membership rows for removal detection
    for (const result of successfulResults) {
      processedIds.trackIds.add(result.trackId);
      processedIds.sptIds.add(result.id);
    }

    // Count rows written (one per item; skipped items excluded)
    processedTracks += successfulResults.length;

    for (const deletedVideo of batchDeletedWithoutMatch) {
      deletedVideosWithoutMatch.push({
        position: deletedVideo.position,
        itemId: deletedVideo.item.id,
        title: deletedVideo.item.snippet?.title,
        snippet: deletedVideo.item.snippet,
        externalId: deletedVideo.externalId,
      });
    }
  }

  return {
    processedCount: processedTracks,
    deletedTracks,
    processedIds,
    pendingMatches: [],
    deletedVideosWithoutMatch,
    removeSptIds: new Set(),
    leaveAloneSptIds: new Set(),
    archiveQueueTickNeeded,
  };
}
