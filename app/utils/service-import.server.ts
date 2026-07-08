/**
 * Service import utilities.
 *
 * Provides importTrackDirectly() for importing a single YouTube video
 * as a Track, auto-enqueuing it for audio archiving.
 *
 * Called from the /music/services/youtube/import page.
 */

import { YOUTUBE_SERVICE } from '#app/constants/services'
import { enqueueArchiveJob } from '#app/features/audio-archive/auto-enqueue.server'
import { getOrCreateArtistTx } from '#app/utils/artist-management.server'
import { prisma } from '#app/utils/db.server'
import { handleServiceError } from '#app/utils/error-handlers.server'
import { getServiceByName } from '#app/utils/playlist-utils.server'
import { getYouTubeVideoDetails } from '#app/utils/youtube-search.server'
import { type Prisma } from '#prisma/client.js'

/**
 * Result type for importTrackDirectly.
 */
export interface ImportTrackResult {
	success: boolean
	trackId?: string
	error?: string
	action: 'created' | 'updated' | 'unchanged' | 'failed'
}

/**
 * Extract YouTube video ID from a URL or return the string as-is if it's
 * already a plain video ID.
 */
export function extractYouTubeVideoId(input: string): string | null {
	const trimmed = input.trim()

	// Already a plain video ID (11 chars alphanumeric + _ -)
	if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) {
		return trimmed
	}

	// Try to extract from various YouTube URL formats
	try {
		const url = new URL(trimmed)
		// youtube.com/watch?v=VIDEO_ID
		if (url.searchParams.has('v')) {
			const v = url.searchParams.get('v')
			if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v
		}
		// youtu.be/VIDEO_ID
		if (
			url.hostname === 'youtu.be' &&
			/^\/[A-Za-z0-9_-]{11}$/.test(url.pathname)
		) {
			return url.pathname.slice(1)
		}
		// youtube.com/embed/VIDEO_ID
		const embedMatch = url.pathname.match(/^\/embed\/([A-Za-z0-9_-]{11})/)
		if (embedMatch) return embedMatch[1]!
	} catch {
		// Not a valid URL — not a valid video ID either
		return null
	}

	return null
}

/**
 * Import a single YouTube video directly as a Track.
 *
 * - Resolves YouTube video details via the YouTube API
 * - Gets or creates the Artist (from channelTitle)
 * - Upserts the Track on serviceId_externalId (idempotent)
 * - Maps publishedAt to releaseDate
 * - Auto-enqueues an ArchiveJob for audio processing
 *
 * @param videoIdOrUrl - YouTube video ID or full URL
 * @returns ImportTrackResult with success status and trackId
 */
export async function importTrackDirectly(
	videoIdOrUrl: string,
): Promise<ImportTrackResult> {
	// Extract video ID from URL
	const videoId = extractYouTubeVideoId(videoIdOrUrl)
	if (!videoId) {
		return {
			success: false,
			error: 'Invalid YouTube video ID or URL. Please provide a valid YouTube URL or video ID.',
			action: 'failed',
		}
	}

	try {
		// Fetch video details from YouTube API
		const videoDetails = await getYouTubeVideoDetails(videoId)

		// Look up the YouTube service
		const service = await getServiceByName(YOUTUBE_SERVICE.NAME)

		// Use a transaction for atomicity
		const result = await prisma.$transaction(async (tx) => {
			// Get or create the artist (from channelTitle)
			const artist = await getOrCreateArtistTx(tx, videoDetails.artist)

			// Upsert track on serviceId_externalId
			const trackCreateData = {
				title: videoDetails.title,
				artistId: artist.id,
				serviceId: service.id,
				externalId: videoId,
				serviceUrl: videoDetails.serviceUrl,
				duration: videoDetails.duration,
				releaseDate: videoDetails.publishedAt
					? new Date(videoDetails.publishedAt)
					: null,
			}

			const existingTrack = await tx.track.findUnique({
				where: {
					serviceId_externalId: {
						serviceId: service.id,
						externalId: videoId,
					},
				},
				select: { id: true },
			})

			const track = await tx.track.upsert({
				where: {
					serviceId_externalId: {
						serviceId: service.id,
						externalId: videoId,
					},
				},
				update: {
					title: videoDetails.title,
					artistId: artist.id,
					duration: videoDetails.duration,
					releaseDate: videoDetails.publishedAt
						? new Date(videoDetails.publishedAt)
						: null,
					updatedAt: new Date(),
				},
				create: trackCreateData,
				select: { id: true },
			})

			// Auto-enqueue for audio archiving (caller decides when to invoke)
			await enqueueArchiveJob(tx, track.id)

			const action = existingTrack ? 'updated' : 'created'
			return { trackId: track.id, action }
		})

		return {
			success: true,
			trackId: result.trackId,
			action: result.action as 'created' | 'updated',
		}
	} catch (error) {
		// YouTube-specific errors (quota, auth, not found) bubble up naturally
		// as they extend Error and will be caught here
		const handled = handleServiceError(error, 'importTrackDirectly', 'YouTube')
		return {
			...handled,
			action: 'failed' as const,
		}
	}
}
