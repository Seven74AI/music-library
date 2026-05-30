import { getOrCreateArtistTx } from '#app/utils/artist-management.server'

/**
 * Generic syncable item — normalized track data from any provider.
 *
 * Providers (YouTube, Spotify, etc.) pass their items through this shape.
 * The batch processor does NOT depend on YouTube-specific types;
 * it only accesses the fields defined here.
 */
export interface SyncableItem {
  id?: string
  snippet?: {
    title?: string
    resourceId?: { videoId?: string }
    videoOwnerChannelTitle?: string
    channelTitle?: string
    thumbnails?: {
      medium?: { url?: string }
      default?: { url?: string }
    }
  }
}

/**
 * Provider contract required by the batch processor.
 *
 * The batch processor only needs three methods from the provider:
 * deleted-video detection, preservation decision, and item transformation.
 * Uses `any` for item types to be structurally compatible with any
 * concrete provider (YouTube, Spotify, etc.) — the caller passes the
 * right provider for their items.
 */
export interface BatchProcessorProvider {
  isDeletedVideo(item: any): boolean
  shouldPreserveTrackData(
    existingTrack: { title: string } | null,
    item: any,
  ): boolean
  transformPlaylistItem(
    item: any,
    serviceId: string,
    artistId: string,
  ): {
    title: string
    duration?: number | null
    externalUrl?: string | null
    releaseDate?: Date | string | null
    thumbnailUrl?: string | null
    service: { connect: { id: string } }
    externalId: string
    artistId: string
    [key: string]: any
  }
}

/**
 * Batch data structure for processing tracks in batches.
 * Used for efficient database operations during playlist sync.
 */
export interface TrackDataBatch<TItem extends SyncableItem = SyncableItem> {
  serviceId: string
  externalId: string
  trackData: Omit<
    ReturnType<BatchProcessorProvider['transformPlaylistItem']>,
    'thumbnailUrl' | 'service' | 'externalId'
  > & { serviceId: string; externalId: string; coverImageId?: string | null }
  position: number
  item: TItem
}

/**
 * Track information for sync reporting.
 */
export interface SyncTrackInfo {
  id: string
  title: string
  externalId?: string
}

/**
 * Pending match for deleted videos that need user confirmation.
 */
export interface PendingMatch {
  deletedVideo: {
    position: number
    itemId: string | undefined
    title: string | undefined
    snippet: SyncableItem['snippet']
  }
  candidateTracks: Array<{
    id: string
    title: string
    artist: string
    externalId: string | null
    position: number
    isDeleted: boolean
  }>
}

/**
 * Result from processing tracks in batches.
 */
export interface ProcessTracksResult {
  processedCount: number
  deletedTracks: SyncTrackInfo[]
  processedExternalIds: Set<string>
  processedTrackIds: Set<string>
  pendingMatches: PendingMatch[]
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
export async function findOrphanedTracks(
  playlistId: string,
  processedExternalIds: Set<string>,
  processedTrackIds: Set<string>,
  pendingMatches: PendingMatch[],
  tx: any,
): Promise<
  Array<{
    id: string
    title: string
    artist: string
    externalId: string | null
    position: number
    isDeleted: boolean
  }>
> {
  // Get all tracks in the playlist
  const allPlaylistTracks = await tx.servicePlaylistTrack.findMany({
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
    orderBy: {
      position: 'asc',
    },
  })

  // Get track IDs already claimed in pending matches
  const claimedTrackIds = new Set<string>()
  for (const match of pendingMatches) {
    for (const candidate of match.candidateTracks) {
      claimedTrackIds.add(candidate.id)
    }
  }

  // Filter orphaned tracks:
  // 1. Not in processedExternalIds or processedTrackIds (not in current sync)
  // 2. Not already deleted (isDeleted === false) - Edge Case 9
  // 3. Not already claimed in pending matches
  const orphanedTracks = allPlaylistTracks
    .filter(
      (playlistTrack: {
        track: { externalId: string | null; id: string }
        isDeleted: boolean
      }) => {
        const externalId = playlistTrack.track.externalId
        const trackId = playlistTrack.track.id

        // Skip if already processed in current sync
        if (externalId && processedExternalIds.has(externalId)) return false
        if (processedTrackIds.has(trackId)) return false

        // Skip if already deleted - Edge Case 9
        if (playlistTrack.isDeleted) return false

        // Skip if already claimed in pending matches
        if (claimedTrackIds.has(trackId)) return false

        return true
      },
    )
    .map(
      (playlistTrack: {
        track: {
          id: string
          title: string
          artist: { id: string; name: string } | null
          externalId: string | null
        }
        position: number
        isDeleted: boolean
      }) => ({
        id: playlistTrack.track.id,
        title: playlistTrack.track.title,
        artist: playlistTrack.track.artist?.name || 'Unknown Artist',
        externalId: playlistTrack.track.externalId,
        position: playlistTrack.position,
        isDeleted: playlistTrack.isDeleted,
      }),
    )

  return orphanedTracks
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
 * @param provider - Service provider (structurally typed)
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
  provider: BatchProcessorProvider,
  globalStartPosition: number = 0,
  accumulatedProcessedExternalIds?: Set<string>,
  accumulatedProcessedTrackIds?: Set<string>,
): Promise<ProcessTracksResult> {
  let processedTracks = 0
  const batchSize = 50
  const deletedTracks: SyncTrackInfo[] = []
  // Merge accumulated sets with new sets to track all processed items across batches
  const processedExternalIds = new Set<string>(
    accumulatedProcessedExternalIds || [],
  )
  const processedTrackIds = new Set<string>(
    accumulatedProcessedTrackIds || [],
  )
  const pendingMatches: PendingMatch[] = []

  for (
    let batchStart = 0;
    batchStart < playlistItems.length;
    batchStart += batchSize
  ) {
    const batch = playlistItems.slice(batchStart, batchStart + batchSize)

    // Prepare batch data
    const trackDataBatch: TrackDataBatch<TItem>[] = []
    // Collect deleted videos without matches for second pass (orphaned track detection)
    const deletedVideosWithoutMatch: Array<{
      item: TItem
      position: number
      externalId: string
    }> = []

    // FIRST PASS: Process all items in the batch
    for (let i = 0; i < batch.length; i++) {
      const item = batch[i] as TItem
      if (!item) continue

      // Use videoId if available, otherwise use playlist item ID or generate unique identifier
      // This prevents multiple deleted videos from collapsing into a single track record
      let externalId = item.snippet?.resourceId?.videoId || ''
      const position = globalStartPosition + batchStart + i + 1
      const isDeleted = provider.isDeletedVideo(item)

      // Try to find existing track by stable identifiers
      let existingTrack: {
        id: string
        title: string
        artistId: string
        coverImageId: string | null
        externalId: string | null
      } | null = null

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
        })
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
        })
      }

      // For deleted videos without a match, defer orphaned track detection to second pass
      // This ensures all tracks in the current batch are processed first
      if (isDeleted && !existingTrack) {
        // Generate a temporary externalId for tracking
        if (item.id) {
          externalId = item.id
        } else {
          externalId = `pending-${playlistId}-${item.id || position}`
        }

        // Store for second pass processing
        deletedVideosWithoutMatch.push({
          item,
          position,
          externalId,
        })

        // Mark externalId as processed to prevent it from being marked as "removed"
        // This ensures pending deleted videos aren't deleted before user confirmation
        processedExternalIds.add(externalId)

        // Skip creating track immediately - wait for user confirmation
        continue
      }

      // Generate externalId for deleted videos if not already set
      if (isDeleted && !externalId) {
        if (item.id) {
          externalId = item.id
        } else {
          externalId = `deleted-${playlistId}-${position}`
        }
      }

      // Skip tracks without a valid externalId (can't use unique constraint with empty string)
      // Deleted videos should have been handled above with generated IDs
      if (!externalId || externalId.trim() === '') {
        console.warn(
          `Skipping track without externalId at position ${position}: ${item.snippet?.title || 'Unknown'}`,
        )
        continue
      }

      try {
        // Get or create artist
        const artistName =
          item.snippet?.videoOwnerChannelTitle ||
          item.snippet?.channelTitle ||
          'Unknown Artist'
        const artistRecord = await getOrCreateArtistTx(tx, artistName)

        // Determine if we should preserve existing track data
        const preserveData = provider.shouldPreserveTrackData(
          existingTrack,
          item,
        )

        // Skip image processing during sync - will be processed in background
        // Preserve existing coverImageId if available, otherwise set to null
        const coverImageId: string | null =
          preserveData && existingTrack?.coverImageId
            ? existingTrack.coverImageId
            : null

        let trackData: Omit<
          ReturnType<BatchProcessorProvider['transformPlaylistItem']>,
          'thumbnailUrl' | 'service' | 'externalId'
        > & { serviceId: string; externalId: string; coverImageId?: string | null }

        if (preserveData && existingTrack) {
          // Preserve existing data, only update non-critical fields
          // Use existing artistId if preserving data
          const transformed = provider.transformPlaylistItem(
            item,
            serviceId,
            existingTrack.artistId,
          )
          const {
            thumbnailUrl: _,
            service: __,
            externalId: ___,
            ...rest
          } = transformed
          trackData = {
            ...rest,
            serviceId, // Use serviceId directly instead of service relation
            title: existingTrack.title,
            artistId: existingTrack.artistId,
            coverImageId: coverImageId || existingTrack.coverImageId || null,
            externalId, // Use the generated/actual externalId (explicitly set, not from transformation)
          }
        } else {
          const transformed = provider.transformPlaylistItem(
            item,
            serviceId,
            artistRecord.id,
          )
          const {
            thumbnailUrl: _,
            service: __,
            externalId: ___,
            ...rest
          } = transformed
          trackData = {
            ...rest,
            serviceId, // Use serviceId directly instead of service relation
            coverImageId,
            externalId, // Override with the generated/actual externalId (explicitly set, not from transformation)
          }
        }

        trackDataBatch.push({
          serviceId,
          externalId,
          trackData,
          position, // Use the calculated position that includes globalStartPosition
          item,
        })

        // Mark as processed after successful preparation
        // Always add externalId, even for deleted videos with generated IDs
        processedExternalIds.add(externalId)
      } catch (error) {
        console.error(
          `Error preparing track ${item.snippet?.resourceId?.videoId || 'unknown'}:`,
          error,
        )
        // externalId is NOT added to processedExternalIds on error, so it will be removed if it exists
      }
    }

    // Batch upsert tracks
    const trackPromises = trackDataBatch
      .filter(({ serviceId: sid, externalId: eid }) => {
        // Filter out any entries with invalid IDs (shouldn't happen, but safety check)
        if (!sid || !eid || eid.trim() === '') {
          console.warn(
            `Skipping track upsert with invalid IDs: serviceId=${sid}, externalId=${eid}`,
          )
          return false
        }
        return true
      })
      .map(async ({ serviceId: sid, externalId: eid, trackData: td }) => {
        // Final validation: ensure both serviceId and externalId are non-empty strings
        // SQLite unique indexes on nullable columns require non-null, non-empty values for upsert
        if (
          !sid ||
          !eid ||
          sid.trim() === '' ||
          eid.trim() === ''
        ) {
          console.error(
            `Invalid upsert parameters: serviceId="${sid}", externalId="${eid}"`,
          )
          throw new Error(
            `Cannot upsert track: serviceId and externalId must be non-empty strings. Got serviceId="${sid}", externalId="${eid}"`,
          )
        }

        // Ensure trackData has the correct serviceId and externalId for the create clause
        // This is critical for SQLite unique constraint matching
        const createData = {
          ...td,
          serviceId: sid, // Explicitly set to ensure it matches the where clause
          externalId: eid, // Explicitly set to ensure it matches the where clause
        }

        // Validate createData has required fields
        if (
          !createData.serviceId ||
          !createData.externalId ||
          createData.serviceId.trim() === '' ||
          createData.externalId.trim() === ''
        ) {
          console.error(
            `Invalid createData: serviceId="${createData.serviceId}", externalId="${createData.externalId}"`,
          )
          throw new Error(
            `Cannot create track: createData must have non-empty serviceId and externalId`,
          )
        }

        return tx.track.upsert({
          where: {
            serviceId_externalId: {
              serviceId: sid,
              externalId: eid,
            },
          },
          update: {
            ...td,
            serviceId: sid, // Ensure update also has correct values
            externalId: eid, // Ensure update also has correct values
            updatedAt: new Date(),
          },
          create: createData,
        })
      })

    const tracks = await Promise.all(trackPromises)

    // Batch upsert playlist tracks with deletion status
    const playlistTrackPromises = tracks.map(async (track, index) => {
      const trackData = trackDataBatch[index]
      if (!trackData) return null

      // Use the item stored with trackData to avoid index mismatch when items are skipped
      const item = trackData.item
      const isDeleted = item ? provider.isDeletedVideo(item) : false

      // Get thumbnailUrl from API response
      const thumbnailUrl =
        item?.snippet?.thumbnails?.medium?.url ||
        item?.snippet?.thumbnails?.default?.url ||
        null

      // Check if this track was previously deleted
      const existingPlaylistTrack = await tx.servicePlaylistTrack.findUnique({
        where: {
          playlistId_trackId: {
            playlistId: playlistId,
            trackId: track.id,
          },
        },
      })

      const shouldSetDeletedAt =
        isDeleted && !existingPlaylistTrack?.isDeleted

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
      })

      // Track deleted videos for reporting - only report newly detected deletions
      if (shouldSetDeletedAt) {
        deletedTracks.push({
          id: track.id,
          title: track.title,
          externalId: trackData.externalId,
        })
      }

      return result
    })

    // Await all promises first, then filter out null results
    const playlistTrackResults = await Promise.all(playlistTrackPromises)
    const successfulResults = playlistTrackResults.filter(
      (result): result is NonNullable<typeof result> => result !== null,
    )

    // Track all successfully processed trackIds for removal detection
    for (const result of successfulResults) {
      processedTrackIds.add(result.trackId)
    }

    // Count only successfully processed tracks
    processedTracks += successfulResults.length

    // SECOND PASS: Find orphaned tracks for deleted videos without matches
    // This happens AFTER all tracks in the current batch are processed and added to processedTrackIds
    // This prevents false positives where tracks in the current batch are incorrectly marked as orphaned
    for (const deletedVideo of deletedVideosWithoutMatch) {
      // Find orphaned tracks (tracks in playlist but not in current sync)
      // At this point, processedTrackIds includes all tracks from previous batches AND the current batch
      const orphanedTracks = await findOrphanedTracks(
        playlistId,
        processedExternalIds,
        processedTrackIds,
        pendingMatches,
        tx,
      )

      // Add to pendingMatches for user confirmation
      pendingMatches.push({
        deletedVideo: {
          position: deletedVideo.position,
          itemId: deletedVideo.item.id,
          title: deletedVideo.item.snippet?.title,
          snippet: deletedVideo.item.snippet,
        },
        candidateTracks: orphanedTracks,
      })
    }
  }

  return {
    processedCount: processedTracks,
    deletedTracks,
    processedExternalIds,
    processedTrackIds,
    pendingMatches,
  }
}
