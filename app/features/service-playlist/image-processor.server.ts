import { pickCoverThumbnailUrl } from '#app/types/transformations'
import {
	downloadExternalImage,
	findOrCreateCoverImage,
} from '#app/utils/cover-management.server'
import { prisma } from '#app/utils/db.server'

const MAX_CONCURRENCY = 3
const BATCH_DELAY_MS = 100
const QUERY_PAGE_SIZE = 100

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
 * Fire-and-forget post-sync cover image processing.
 */
export async function processTrackImagesAsync(playlistId: string): Promise<void> {
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
					const imageBuffer = await downloadExternalImage(playlistTrack.thumbnailUrl)
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

		const hasMoreBatches = i + MAX_CONCURRENCY < tracksToProcess.length
		if (hasMoreBatches) {
			await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS))
		}
	}
}
