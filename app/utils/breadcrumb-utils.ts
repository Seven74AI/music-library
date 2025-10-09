/**
 * Utility functions for breadcrumb type safety
 */

/**
 * Type guard to check if data has a track property
 */
export function hasTrack(data: unknown): data is { track?: { title?: string } } {
	return typeof data === 'object' && data !== null && 'track' in data
}

/**
 * Type guard to check if data has a playlist property
 */
export function hasPlaylist(data: unknown): data is { playlist?: { title?: string } } {
	return typeof data === 'object' && data !== null && 'playlist' in data
}

/**
 * Safely extract track title from breadcrumb data
 */
export function getTrackTitle(data: unknown, fallback = 'Track'): string {
	if (hasTrack(data)) {
		return data.track?.title || fallback
	}
	return fallback
}

/**
 * Safely extract playlist title from breadcrumb data
 */
export function getPlaylistTitle(data: unknown, fallback = 'Playlist'): string {
	if (hasPlaylist(data)) {
		return data.playlist?.title || fallback
	}
	return fallback
}
