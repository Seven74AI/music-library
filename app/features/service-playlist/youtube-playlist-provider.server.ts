import { YOUTUBE_SERVICE } from '#app/constants/services'
import {
	transformYouTubePlaylistItemToTrack,
	transformYouTubePlaylistToServicePlaylist,
} from '#app/types/transformations'
import { type YouTubePlaylist, type YouTubePlaylistItem } from '#app/types/youtube-api'
import { type Prisma } from '#prisma/client.js'
import { createYouTubeService, type YouTubeService } from '#app/utils/youtube.server'
import { type PlaylistSyncProvider } from './playlist-sync-provider.server'

/**
 * Internal track-processing contract used by the batch processor.
 * Not part of the public provider seam (fetch + normalize only).
 */
export interface TrackSyncProcessor {
	isDeletedVideo(item: any): boolean
	shouldPreserveTrackData(
		existingTrack: { title: string } | null,
		item: any,
	): boolean
	transformPlaylistItem(
		item: any,
		serviceId: string,
		artistId: string,
	): Omit<Prisma.TrackCreateInput, 'artist'> & {
		artistId: string
		thumbnailUrl?: string | null
	}
}

export class YouTubePlaylistProvider implements PlaylistSyncProvider, TrackSyncProcessor {
	private youtubeService: YouTubeService

	constructor(youtubeService?: YouTubeService) {
		this.youtubeService = youtubeService ?? createYouTubeService()
	}

	isDeletedVideo(item: YouTubePlaylistItem): boolean {
		const title = item.snippet?.title || ''
		const videoId = item.snippet?.resourceId?.videoId

		const deletedPatterns = [
			/^deleted video$/i,
			/^private video$/i,
			/^unavailable video$/i,
			/^video unavailable$/i,
			/^this video is unavailable$/i,
		]

		const hasDeletedTitle = deletedPatterns.some((pattern) => pattern.test(title))
		const missingVideoId = !videoId || videoId.trim() === ''
		const missingThumbnail = !item.snippet?.thumbnails?.default?.url

		return hasDeletedTitle || missingVideoId || missingThumbnail
	}

	shouldPreserveTrackData(
		existingTrack: { title: string } | null,
		newItem: YouTubePlaylistItem,
	): boolean {
		if (!existingTrack) return false

		if (
			this.isDeletedVideo(newItem) &&
			existingTrack.title !== 'Deleted video' &&
			existingTrack.title !== 'Unknown Title'
		) {
			return true
		}

		return false
	}

	async fetchPlaylists(token: string, _userId: string): Promise<YouTubePlaylist[]> {
		return this.youtubeService.getUserPlaylists(token)
	}

	async fetchPlaylist(externalId: string, token: string): Promise<YouTubePlaylist> {
		return this.youtubeService.getPlaylist(externalId, token)
	}

	async fetchPlaylistItems(
		externalId: string,
		token: string,
	): Promise<YouTubePlaylistItem[]> {
		return this.youtubeService.getPlaylistItems(externalId, token)
	}

	supportsService(serviceName: string): boolean {
		return serviceName === YOUTUBE_SERVICE.NAME
	}

	transformPlaylistItem(
		item: YouTubePlaylistItem,
		serviceId: string,
		artistId: string,
	): Omit<Prisma.TrackCreateInput, 'artist'> & {
		artistId: string
		thumbnailUrl?: string | null
	} {
		return transformYouTubePlaylistItemToTrack(item, serviceId, artistId)
	}

	normalizePlaylistData(
		rawPlaylist: unknown,
		serviceId: string,
		userId: string,
	): {
		title: string
		description: string | null
		externalId: string
		itemCount: number
		channelId: string | null
		channelTitle: string | null
		thumbnailUrl: string | null
	} {
		const data = transformYouTubePlaylistToServicePlaylist(
			rawPlaylist as YouTubePlaylist,
			serviceId,
			userId,
		)
		return {
			title: data.title,
			description: data.description ?? null,
			externalId: data.externalId,
			itemCount: data.itemCount,
			channelId: data.channelId ?? null,
			channelTitle: data.channelTitle ?? null,
			thumbnailUrl: data.thumbnailUrl ?? null,
		}
	}
}

export function createYouTubePlaylistProvider(
	youtubeService?: YouTubeService,
): YouTubePlaylistProvider {
	return new YouTubePlaylistProvider(youtubeService)
}
