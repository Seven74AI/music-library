import { pickCoverThumbnailUrl } from "#app/types/transformations";
import { getOrCreateArtistTx } from "#app/utils/artist-management.server";
import { prisma } from "#app/utils/db.server";
import { type Prisma } from "#prisma/client.js";
import { type ArchiveEnqueueAdapter } from "./archive-enqueue-adapter.server";
import { getServiceByName } from "./playlist-utils.server";
import { findAllServicePlaylistTracks } from "./service-playlist-track-queries.server";
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
 * Result from processing tracks in batches.
 */
export interface ProcessTracksResult {
  processedCount: number;
  deletedTracks: SyncTrackInfo[];
  processedExternalIds: Set<string>;
  processedTrackIds: Set<string>;
  pendingMatches: PendingMatch[];
}

/**
 * Find orphaned tracks (tracks in playlist but not in current sync).
 * These are candidates for matching with deleted videos.
 *
 * Standalone function — moved from ServicePlaylistService facade.
 *
 * @param playlistId - The playlist ID
 * @param processedExternalIds - Set of external IDs that were processed in current sync
 * @param processedTrackIds - Set of track IDs that were processed in current sync
 * @param pendingMatches - Array of existing pending matches to avoid duplicate suggestions
 * @param tx - Prisma transaction instance
 * @returns Array of orphaned tracks with metadata
 */
type PlaylistTrackForOrphanDetection = {
  track: {
    id: string;
    title: string;
    artist: { id: string; name: string } | null;
    externalId: string | null;
  };
  position: number;
  isDeleted: boolean;
};

export function filterOrphanedTracks(
  allPlaylistTracks: PlaylistTrackForOrphanDetection[],
  processedExternalIds: Set<string>,
  processedTrackIds: Set<string>,
  pendingMatches: PendingMatch[],
): Array<{
  id: string;
  title: string;
  artist: string;
  externalId: string | null;
  position: number;
  isDeleted: boolean;
}> {
  const claimedTrackIds = new Set<string>();
  for (const match of pendingMatches) {
    for (const candidate of match.candidateTracks) {
      claimedTrackIds.add(candidate.id);
    }
  }

  return allPlaylistTracks
    .filter((playlistTrack) => {
      const externalId = playlistTrack.track.externalId;
      const trackId = playlistTrack.track.id;

      if (externalId && processedExternalIds.has(externalId)) return false;
      if (processedTrackIds.has(trackId)) return false;
      if (playlistTrack.isDeleted) return false;
      if (claimedTrackIds.has(trackId)) return false;

      return true;
    })
    .map((playlistTrack) => ({
      id: playlistTrack.track.id,
      title: playlistTrack.track.title,
      artist: playlistTrack.track.artist?.name || "Unknown Artist",
      externalId: playlistTrack.track.externalId,
      position: playlistTrack.position,
      isDeleted: playlistTrack.isDeleted,
    }));
}

export async function findOrphanedTracks(
  playlistId: string,
  processedExternalIds: Set<string>,
  processedTrackIds: Set<string>,
  pendingMatches: PendingMatch[],
  tx: any,
): Promise<
  Array<{
    id: string;
    title: string;
    artist: string;
    externalId: string | null;
    position: number;
    isDeleted: boolean;
  }>
> {
  const allPlaylistTracks = (
    await findAllServicePlaylistTracks(tx, {
      where: {
        playlistId: playlistId,
      },
      include: {
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
      },
    })
  ).sort((a, b) => a.position - b.position);

  return filterOrphanedTracks(
    allPlaylistTracks,
    processedExternalIds,
    processedTrackIds,
    pendingMatches,
  );
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
 * @param accumulatedProcessedExternalIds - External IDs already processed in prior batches
 * @param accumulatedProcessedTrackIds - Track IDs already processed in prior batches
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
  accumulatedProcessedExternalIds?: Set<string>,
  accumulatedProcessedTrackIds?: Set<string>,
): Promise<ProcessTracksResult> {
  let processedTracks = 0;
  const batchSize = 50;
  const deletedTracks: SyncTrackInfo[] = [];
  // Merge accumulated sets with new sets to track all processed items across batches
  const processedExternalIds = new Set<string>(accumulatedProcessedExternalIds || []);
  const processedTrackIds = new Set<string>(accumulatedProcessedTrackIds || []);
  const pendingMatches: PendingMatch[] = [];

  for (let batchStart = 0; batchStart < playlistItems.length; batchStart += batchSize) {
    const batch = playlistItems.slice(batchStart, batchStart + batchSize);

    // Prepare batch data
    const trackDataBatch: TrackDataBatch<TItem>[] = [];
    // Collect deleted videos without matches for second pass (orphaned track detection)
    const deletedVideosWithoutMatch: Array<{
      item: TItem;
      position: number;
      externalId: string;
    }> = [];

    // FIRST PASS: Process all items in the batch
    for (let i = 0; i < batch.length; i++) {
      const item = batch[i] as TItem;
      if (!item) continue;

      // Use videoId if available, otherwise use playlist item ID or generate unique identifier
      // This prevents multiple deleted videos from collapsing into a single track record
      let externalId = item.snippet?.resourceId?.videoId || "";
      const position = globalStartPosition + batchStart + i + 1;
      const isDeleted = trackProcessor.isDeletedVideo(item);

      // Try to find existing track by stable identifiers
      let existingTrack: {
        id: string;
        title: string;
        artistId: string;
        coverImageId: string | null;
        externalId: string | null;
      } | null = null;

      // First, try matching by playlist item ID (for deleted videos)
      if (isDeleted && item.id) {
        // Try to find a track with this playlist item ID as externalId
        existingTrack = await tx.track.findUnique({
          where: {
            serviceId_externalId: {
              serviceId,
              externalId: item.id,
            },
          },
          select: {
            id: true,
            title: true,
            artistId: true,
            coverImageId: true,
            externalId: true,
          },
        });
      }

      // If not found, try matching by videoId (externalId)
      if (!existingTrack && externalId) {
        existingTrack = await tx.track.findUnique({
          where: {
            serviceId_externalId: {
              serviceId,
              externalId,
            },
          },
          select: {
            id: true,
            title: true,
            artistId: true,
            coverImageId: true,
            externalId: true,
          },
        });
      }

      // For deleted videos without a match, defer orphaned track detection to second pass
      // This ensures all tracks in the current batch are processed first
      if (isDeleted && !existingTrack) {
        // Generate a temporary externalId for tracking
        if (item.id) {
          externalId = item.id;
        } else {
          externalId = `pending-${playlistId}-${item.id || position}`;
        }

        // Store for second pass processing
        deletedVideosWithoutMatch.push({
          item,
          position,
          externalId,
        });

        // Mark externalId as processed to prevent it from being marked as "removed"
        // This ensures pending deleted videos aren't deleted before user confirmation
        processedExternalIds.add(externalId);

        // Skip creating track immediately - wait for user confirmation
        continue;
      }

      // Generate externalId for deleted videos if not already set
      if (isDeleted && !externalId) {
        if (item.id) {
          externalId = item.id;
        } else {
          externalId = `deleted-${playlistId}-${position}`;
        }
      }

      // Skip tracks without a valid externalId (can't use unique constraint with empty string)
      // Deleted videos should have been handled above with generated IDs
      if (!externalId || externalId.trim() === "") {
        console.warn(
          `Skipping track without externalId at position ${position}: ${item.snippet?.title || "Unknown"}`,
        );
        continue;
      }

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
        processedExternalIds.add(externalId);
      } catch (error) {
        console.error(
          `Error preparing track ${item.snippet?.resourceId?.videoId || "unknown"}:`,
          error,
        );
        // externalId is NOT added to processedExternalIds on error, so it will be removed if it exists
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
      const isDeleted = item ? trackProcessor.isDeletedVideo(item) : false;

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
      processedTrackIds.add(result.trackId);
    }

    // Count only successfully processed tracks
    processedTracks += successfulResults.length;

    // SECOND PASS: Find orphaned tracks for deleted videos without matches
    // This happens AFTER all tracks in the current batch are processed and added to processedTrackIds
    // This prevents false positives where tracks in the current batch are incorrectly marked as orphaned
    if (deletedVideosWithoutMatch.length > 0) {
      const allPlaylistTracks = (
        await findAllServicePlaylistTracks(tx, {
          where: { playlistId },
          include: {
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
          },
        })
      ).sort((a, b) => a.position - b.position);

      for (const deletedVideo of deletedVideosWithoutMatch) {
        const orphanedTracks = filterOrphanedTracks(
          allPlaylistTracks,
          processedExternalIds,
          processedTrackIds,
          pendingMatches,
        );

        pendingMatches.push({
          deletedVideo: {
            position: deletedVideo.position,
            itemId: deletedVideo.item.id,
            title: deletedVideo.item.snippet?.title,
            snippet: deletedVideo.item.snippet,
          },
          candidateTracks: orphanedTracks,
        });
      }
    }
  }

  return {
    processedCount: processedTracks,
    deletedTracks,
    processedExternalIds,
    processedTrackIds,
    pendingMatches,
  };
}

/**
 * Confirm deleted video matches — process user selections for pending matches.
 *
 * Extracted from ServicePlaylistService facade. Handles the full match resolution
 * workflow: creating new tracks for deleted videos, matching to existing tracks,
 * or skipping.
 *
 * @param playlistId - The playlist ID
 * @param matches - Array of user selections: { deletedItemId, selectedTrackId, position, action }
 * @param userId - The user ID
 * @returns Result with success count and any errors
 */
export async function confirmOrphanedMatches(
  playlistId: string,
  matches: Array<{
    deletedItemId: string | undefined;
    selectedTrackId: string | null;
    position: number;
    action: "match" | "new" | "skip";
  }>,
  userId: string,
): Promise<{
  success: boolean;
  processedCount: number;
  message: string;
  error?: string;
}> {
  // Verify playlist ownership
  const playlist = await prisma.servicePlaylist.findFirst({
    where: {
      id: playlistId,
      ownerId: userId,
      isActive: true,
    },
    include: { service: true },
  });

  if (!playlist) {
    return {
      success: false,
      processedCount: 0,
      message: "Playlist not found or access denied",
      error: "Playlist not found or access denied",
    };
  }

  if (!playlist.service) {
    return {
      success: false,
      processedCount: 0,
      message: "Service not found for playlist",
      error: "Service not found for playlist",
    };
  }

  const service = await getServiceByName(playlist.service.name);
  const { createId } = await import("@paralleldrive/cuid2");

  try {
    // Process all matches in a single transaction
    const result = await prisma.$transaction(async (tx) => {
      let processedCount = 0;

      for (const match of matches) {
        if (match.action === "skip") {
          continue;
        }

        if (match.action === "new") {
          // Create new track with generated ID
          const newTrackId = createId();
          const externalId = match.deletedItemId || `deleted-${playlistId}-${match.position}`;

          // Get or create artist
          const artistRecord = await getOrCreateArtistTx(tx, "Unknown Artist");

          // Create track
          const track = await tx.track.create({
            data: {
              id: newTrackId,
              title: "Deleted video",
              artistId: artistRecord.id,
              duration: null,
              externalId,
              serviceId: service.id,
              serviceUrl: null,
              releaseDate: null,
            },
          });

          // Create ServicePlaylistTrack
          await tx.servicePlaylistTrack.create({
            data: {
              id: createId(),
              playlistId,
              trackId: track.id,
              position: match.position,
              isDeleted: true,
              deletedAt: new Date(),
            },
          });

          processedCount++;
        } else if (match.action === "match" && match.selectedTrackId) {
          // Match deleted video to existing track
          const track = await tx.track.findUnique({
            where: { id: match.selectedTrackId },
          });

          if (!track) {
            throw new Error(`Track not found: ${match.selectedTrackId}`);
          }

          // Check if ServicePlaylistTrack already exists
          const existingPlaylistTrack = await tx.servicePlaylistTrack.findUnique({
            where: {
              playlistId_trackId: {
                playlistId,
                trackId: track.id,
              },
            },
          });

          if (existingPlaylistTrack) {
            // Update existing record
            await tx.servicePlaylistTrack.update({
              where: {
                playlistId_trackId: {
                  playlistId,
                  trackId: track.id,
                },
              },
              data: {
                position: match.position,
                isDeleted: true,
                deletedAt: existingPlaylistTrack.deletedAt || new Date(),
              },
            });
          } else {
            // Create new ServicePlaylistTrack
            await tx.servicePlaylistTrack.create({
              data: {
                id: createId(),
                playlistId,
                trackId: track.id,
                position: match.position,
                isDeleted: true,
                deletedAt: new Date(),
              },
            });
          }

          processedCount++;
        }
      }

      return { processedCount };
    });

    return {
      success: true,
      processedCount: result.processedCount,
      message: `Successfully processed ${result.processedCount} match(es).`,
    };
  } catch (error) {
    console.error("Error confirming deleted video matches:", error);
    const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred";
    return {
      success: false,
      processedCount: 0,
      message: `Failed to process matches. No changes were made. Please try again.`,
      error: errorMessage,
    };
  }
}
