import { prisma } from '#app/utils/db.server'
import {
  downloadExternalImage,
  findOrCreateCoverImage,
} from '#app/utils/cover-management.server'
import type { SyncableItem } from './track-batch-processor.server'

/** Maximum concurrent image downloads */
const MAX_CONCURRENCY = 5

/**
 * Provider contract needed for pre-downloading images.
 * Only needs `isDeletedVideo` — the image processor doesn't transform data.
 */
interface ImageProcessorProvider<TItem extends SyncableItem = SyncableItem> {
  isDeletedVideo(item: TItem): boolean
}

/**
 * Pre-download cover images for playlist items.
 * Downloads images in parallel to speed up the process.
 *
 * Standalone function — moved from ServicePlaylistService facade.
 *
 * @param playlistItems - Array of playlist items to download images for
 * @param provider - Service provider (structurally typed)
 * @returns Map of externalId to image buffer
 */
export async function preDownloadImages<TItem extends SyncableItem>(
  playlistItems: TItem[],
  provider: ImageProcessorProvider<TItem>,
): Promise<Map<string, Buffer>> {
  const imageMap = new Map<string, Buffer>()

  // Download images in parallel
  const downloadPromises = playlistItems.map(async (item) => {
    // Use the same logic as processTracksInBatches to determine externalId
    let externalId = item.snippet?.resourceId?.videoId || ''
    const isDeleted = provider.isDeletedVideo(item)

    // For deleted videos, use item.id if available, otherwise skip (will be handled in processTracksInBatches)
    if (isDeleted && !externalId) {
      externalId = item.id || ''
    }

    if (!externalId) return

    const thumbnailUrl =
      item.snippet?.thumbnails?.medium?.url ||
      item.snippet?.thumbnails?.default?.url ||
      null
    if (!thumbnailUrl) return

    try {
      const imageBuffer = await downloadExternalImage(thumbnailUrl)
      if (imageBuffer) {
        imageMap.set(externalId, imageBuffer)
      }
    } catch (error) {
      console.warn(
        `Failed to download cover image for ${externalId}:`,
        error,
      )
      // Continue without this image
    }
  })

  await Promise.all(downloadPromises)
  return imageMap
}

/**
 * Process images for playlist tracks in the background (server-side async).
 * This is called after sync completes to process images without blocking the response.
 *
 * Standalone function — moved from ServicePlaylistService facade.
 *
 * @param playlistTrackIds - Array of ServicePlaylistTrack IDs to process images for
 */
export async function processTrackImagesAsync(
  playlistTrackIds: string[],
): Promise<void> {
  // Server-side background processing - runs after response is sent
  // Process images in batches with concurrency control
  await processTrackImagesInBatches(playlistTrackIds)
}

/**
 * Process images in batches with concurrency control.
 *
 * Standalone function — moved from ServicePlaylistService facade.
 *
 * @param playlistTrackIds - Array of ServicePlaylistTrack IDs to process
 */
export async function processTrackImagesInBatches(
  playlistTrackIds: string[],
): Promise<void> {
  // Fetch ServicePlaylistTrack records with thumbnailUrl and trackId
  const playlistTracks = await prisma.servicePlaylistTrack.findMany({
    where: {
      id: { in: playlistTrackIds },
      thumbnailUrl: { not: null },
    },
    include: {
      track: {
        select: {
          id: true,
          coverImageId: true,
        },
      },
    },
  })

  // Filter out tracks that already have cover images
  const tracksToProcess = playlistTracks.filter(
    (pt) => pt.thumbnailUrl && !pt.track.coverImageId,
  )

  if (tracksToProcess.length === 0) {
    return
  }

  // Process images in parallel with concurrency limit
  for (let i = 0; i < tracksToProcess.length; i += MAX_CONCURRENCY) {
    const batch = tracksToProcess.slice(i, i + MAX_CONCURRENCY)

    await Promise.all(
      batch.map(async (playlistTrack) => {
        if (!playlistTrack.thumbnailUrl) return

        try {
          // Download image from thumbnailUrl
          const imageBuffer = await downloadExternalImage(
            playlistTrack.thumbnailUrl,
          )
          if (!imageBuffer) {
            console.warn(
              `Failed to download image from ${playlistTrack.thumbnailUrl}`,
            )
            return
          }

          // Process and create CoverImage
          const coverImage = await findOrCreateCoverImage({
            imageBuffer,
            trackId: playlistTrack.trackId,
          })

          // Update Track.coverImageId
          await prisma.track.update({
            where: { id: playlistTrack.trackId },
            data: { coverImageId: coverImage.id },
          })

          // Optionally clear thumbnailUrl from ServicePlaylistTrack (or keep as fallback)
          // For now, we'll keep it as a fallback in case the processed image fails to load
        } catch (error) {
          console.error(
            `Error processing image for track ${playlistTrack.trackId}:`,
            error,
          )
          // Continue processing other tracks even if one fails
        }
      }),
    )
  }
}
