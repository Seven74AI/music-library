import { type YouTubePlaylist, type YouTubePlaylistItem } from '#app/types/youtube-api'

/**
 * Provider seam for external playlist services — fetch and normalize only.
 *
 * Track processing (deleted-video detection, transforms) lives inside the
 * service-playlist module, not on this interface.
 */
export interface PlaylistSyncProvider {
	fetchPlaylists(token: string, userId: string): Promise<YouTubePlaylist[]>

	fetchPlaylist(externalId: string, token: string): Promise<YouTubePlaylist>

	fetchPlaylistItems(
		externalId: string,
		token: string,
	): Promise<YouTubePlaylistItem[]>

	supportsService(serviceName: string): boolean

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
	}
}
