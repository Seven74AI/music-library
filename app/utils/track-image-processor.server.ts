import { pickCoverThumbnailUrl } from '#app/types/transformations'
import {
  downloadExternalImage,
  findOrCreateCoverImage,
} from '#app/utils/cover-management.server'
import { prisma } from '#app/utils/db.server'
import { type SyncableItem } from './track-batch-processor.server'

/** Maximum concurrent image downloads */
const MAX_CONCURRENCY = 5

/** Page size for playlist track queries (stays under SQLite bind-parameter limits) */
const QUERY_PAGE_SIZE = 100

/**
 * Provider contract needed for pre-downloading images.
 * Only needs `isDeletedVideo` — the image processor doesn't transform data.
 */
interface ImageProcessorProvider<TItem extends SyncableItem = SyncableItem> {
  isDeletedVideo(item: TItem): boolean
}

type PlaylistTrackForProcessing = {
  id: string
  trackId: string
  thumbnailUrl: string | null
  track: {
    id: string
    coverImageId: string | null
  }
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

    const thumbnailUrl = pickCoverThumbnailUrl(item.snippet?.thumbnails)
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
 * @param playlistId - ServicePlaylist ID whose tracks should be processed
 */
export async function processTrackImagesAsync(
  playlistId: string,
): Promise<void> {
  let cursor: string | undefined

  while (true) {
    const playlistTracks = await prisma.servicePlaylistTrack.findMany({
      where: {
        playlistId,
        thumbnailUrl: { not: null },
        track: { coverImageId: null },
      },
      take: QUERY_PAGE_SIZE,
      orderBy: { id: 'asc' },
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      include: {
        track: {
          select: {
            id: true,
            coverImageId: true,
          },
        },
      },
    })

    if (playlistTracks.length === 0) {
      return
    }

    await processPlaylistTrackImages(playlistTracks)

    cursor = playlistTracks[playlistTracks.length - 1]?.id
    if (playlistTracks.length < QUERY_PAGE_SIZE) {
      return
    }
  }
}

async function processPlaylistTrackImages(
  tracksToProcess: PlaylistTrackForProcessing[],
): Promise<void> {
  for (let i = 0; i < tracksToProcess.length; i += MAX_CONCURRENCY) {
    const batch = tracksToProcess.slice(i, i + MAX_CONCURRENCY)

    await Promise.all(
      batch.map(async (playlistTrack) => {
        if (!playlistTrack.thumbnailUrl) return

        try {
          const imageBuffer = await downloadExternalImage(
            playlistTrack.thumbnailUrl,
          )
          if (!imageBuffer) {
            console.warn(
              `Failed to download image from ${playlistTrack.thumbnailUrl}`,
            )
            return
          }

          const coverImage = await findOrCreateCoverImage({
            imageBuffer,
            trackId: playlistTrack.trackId,
          })

          await prisma.track.update({
            where: { id: playlistTrack.trackId },
            data: { coverImageId: coverImage.id },
          })
        } catch (error) {
          console.error(
            `Error processing image for track ${playlistTrack.trackId}:`,
            error,
          )
        }
      }),
    )
  }
}
