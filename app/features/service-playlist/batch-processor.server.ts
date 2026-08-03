import { pickCoverThumbnailUrl } from "#app/types/transformations";
import { getOrCreateArtistTx } from "#app/utils/artist-management.server";
import { prisma } from "#app/utils/db.server";
import {
  classifyAbsentPlaylistTracks,
  isYouTubeVideoId,
  type AbsentPlaylistTrackRow,
  type VideoExistenceLookup,
} from "./absent-track-classification.server";
import { type ArchiveEnqueueAdapter } from "./archive-enqueue-adapter.server";
import { type ResolveVideoExistence } from "./playlist-sync-provider.server";
import { findAllServicePlaylistTracks } from "./service-playlist-track-queries.server";
import { planUnavailableItemProcessing } from "./unavailable-item-plan.server";
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
    console.error("Failed to resolve video existence during playlist sync:", error);
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
      removeSptIds: classification.removeSptIds,
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
      removeSptIds: classification.removeSptIds,
      leaveAloneSptIds: classification.leaveAloneSptIds,
    };
  }

  const { createId } = await import("@paralleldrive/cuid2");
  const deletedTracks: SyncTrackInfo[] = [];
  const nextProcessedIds: ProcessedIdSets = {
    externalIds: processedIds.externalIds,
    trackIds: new Set(processedIds.trackIds),
  };

  await prisma.$transaction(async (tx) => {
    for (const deletedVideo of deletedVideosWithoutMatch) {
      const artistRecord = await getOrCreateArtistTx(tx, "Unknown Artist");
      const trackId = createId();
      const externalId = deletedVideo.externalId;

      await tx.track.create({
        data: {
          id: trackId,
          title: "Deleted video",
          artistId: artistRecord.id,
          duration: null,
          externalId,
          serviceId,
          serviceUrl: null,
          releaseDate: null,
        },
      });

      await tx.servicePlaylistTrack.create({
        data: {
          id: createId(),
          playlistId,
          trackId,
          position: deletedVideo.position,
          isDeleted: true,
          deletedAt: new Date(),
        },
      });

      nextProcessedIds.trackIds.add(trackId);
      deletedTracks.push({
        id: trackId,
        title: "Deleted video",
        externalId,
      });
    }
  });

  return {
    pendingMatches: [],
    autoCreatedCount: deletedTracks.length,
    deletedTracks,
    processedIds: nextProcessedIds,
    removeSptIds: classification.removeSptIds,
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
  tx: any,
  trackProcessor: TrackSyncProcessor,
  archiveEnqueueAdapter: ArchiveEnqueueAdapter,
  globalStartPosition: number = 0,
  accumulatedProcessedIds?: ProcessedIdSets,
): Promise<ProcessTracksResult> {
  let processedTracks = 0;
  const batchSize = 50;
  const deletedTracks: SyncTrackInfo[] = [];
  // Merge accumulated sets with new sets to track all processed items across batches
  const processedIds: ProcessedIdSets = {
    externalIds: new Set<string>(accumulatedProcessedIds?.externalIds || []),
    trackIds: new Set<string>(accumulatedProcessedIds?.trackIds || []),
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
    for (let i = 0; i < batch.length; i++) {
      const item = batch[i] as TItem;
      if (!item) continue;

      const videoId = item.snippet?.resourceId?.videoId || "";
      const position = globalStartPosition + batchStart + i + 1;
      const isUnavailable = trackProcessor.isUnavailableVideo(item);

      // Try to find existing track by stable identifiers
      type ExistingTrackRow = {
        id: string;
        title: string;
        artistId: string;
        coverImageId: string | null;
        externalId: string | null;
      };
      let existingTrack: ExistingTrackRow | null = null;

      const trackSelect = {
        id: true,
        title: true,
        artistId: true,
        coverImageId: true,
        externalId: true,
      } as const;

      // First, try matching by playlist item ID (for deleted videos)
      if (isUnavailable && item.id) {
        existingTrack = await tx.track.findUnique({
          where: {
            serviceId_externalId: {
              serviceId,
              externalId: item.id,
            },
          },
          select: trackSelect,
        });
      }

      // If not found, try matching by videoId (externalId)
      if (!existingTrack && videoId) {
        existingTrack = await tx.track.findUnique({
          where: {
            serviceId_externalId: {
              serviceId,
              externalId: videoId,
            },
          },
          select: trackSelect,
        });
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
        > & { serviceId: string; externalId: string; coverImageId?: string | null };

        if (preserveData && existingTrack) {
          // Preserve existing data, only update non-critical fields
          // Use existing artistId if preserving data
          const transformed = trackProcessor.transformPlaylistItem(
            item,
            serviceId,
            existingTrack.artistId,
          );
          const { thumbnailUrl: _, service: __, externalId: ___, ...rest } = transformed;
          trackData = {
            ...rest,
            serviceId, // Use serviceId directly instead of service relation
            title: existingTrack.title,
            artistId: existingTrack.artistId,
            coverImageId: coverImageId || existingTrack.coverImageId || null,
            externalId, // Use the generated/actual externalId (explicitly set, not from transformation)
          };
        } else {
          const transformed = trackProcessor.transformPlaylistItem(
            item,
            serviceId,
            artistRecord.id,
          );
          const { thumbnailUrl: _, service: __, externalId: ___, ...rest } = transformed;
          trackData = {
            ...rest,
            serviceId, // Use serviceId directly instead of service relation
            coverImageId,
            externalId, // Override with the generated/actual externalId (explicitly set, not from transformation)
          };
        }

        trackDataBatch.push({
          serviceId,
          externalId,
          trackData,
          position, // Use the calculated position that includes globalStartPosition
          item,
        });

        // Mark as processed after successful preparation
        // Always add externalId, even for deleted videos with generated IDs
        processedIds.externalIds.add(externalId);
      } catch (error) {
        console.error(
          `Error preparing track ${item.snippet?.resourceId?.videoId || "unknown"}:`,
          error,
        );
        // externalId is NOT added to processedIds.externalIds on error, so it will be removed if it exists
      }
    }

    // Batch upsert tracks
    const trackPromises = trackDataBatch
      .filter(({ serviceId: sid, externalId: eid }) => {
        // Filter out any entries with invalid IDs (shouldn't happen, but safety check)
        if (!sid || !eid || eid.trim() === "") {
          console.warn(
            `Skipping track upsert with invalid IDs: serviceId=${sid}, externalId=${eid}`,
          );
          return false;
        }
        return true;
      })
      .map(async ({ serviceId: sid, externalId: eid, trackData: td }) => {
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

        const updateData = Object.fromEntries(
          Object.entries({
            ...td,
            serviceId: sid,
            externalId: eid,
            updatedAt: new Date(),
          }).filter(([, value]) => value !== null && value !== undefined),
        );

        return tx.track.upsert({
          where: {
            serviceId_externalId: {
              serviceId: sid,
              externalId: eid,
            },
          },
          update: updateData,
          create: createData,
        });
      });

    const tracks = await Promise.all(trackPromises);

    // Auto-enqueue ArchiveJobs for tracks that have a serviceUrl
    // (external service tracks, e.g. YouTube — not local uploads)
    // Batched: one findMany + one createMany instead of N create() calls
    // that spam unique-constraint errors on re-syncs of large playlists.
    await archiveEnqueueAdapter.enqueueArchiveJobs(
      tx,
      tracks.filter((track) => track.serviceUrl).map((track) => track.id),
    );

    // Batch upsert playlist tracks with deletion status
    const playlistTrackPromises = tracks.map(async (track, index) => {
      const trackData = trackDataBatch[index];
      if (!trackData) return null;

      // Use the item stored with trackData to avoid index mismatch when items are skipped
      const item = trackData.item;
      const isDeleted = item ? trackProcessor.isUnavailableVideo(item) : false;

      // Get thumbnailUrl from API response
      const thumbnailUrl = pickCoverThumbnailUrl(item?.snippet?.thumbnails);

      // Check if this track was previously deleted
      const existingPlaylistTrack = await tx.servicePlaylistTrack.findUnique({
        where: {
          playlistId_trackId: {
            playlistId: playlistId,
            trackId: track.id,
          },
        },
      });

      const shouldSetDeletedAt = isDeleted && !existingPlaylistTrack?.isDeleted;

      const result = await tx.servicePlaylistTrack.upsert({
        where: {
          playlistId_trackId: {
            playlistId: playlistId,
            trackId: track.id,
          },
        },
        update: {
          position: trackData.position,
          isDeleted,
          deletedAt: shouldSetDeletedAt
            ? new Date()
            : isDeleted
              ? existingPlaylistTrack?.deletedAt
              : null,
          thumbnailUrl, // Store thumbnail URL for background processing
        },
        create: {
          playlistId: playlistId,
          trackId: track.id,
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
        });
      }

      return result;
    });

    // Await all promises first, then filter out null results
    const playlistTrackResults = await Promise.all(playlistTrackPromises);
    const successfulResults = playlistTrackResults.filter(
      (result): result is NonNullable<typeof result> => result !== null,
    );

    // Track all successfully processed trackIds for removal detection
    for (const result of successfulResults) {
      processedIds.trackIds.add(result.trackId);
    }

    // Count only successfully processed tracks
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
  };
}
