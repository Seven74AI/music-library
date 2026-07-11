export const OFFLINE_EMPTY = {}

export const OFFLINE_SEARCH = {
	results: [],
	query: '',
	type: 'all' as const,
	pagination: { limit: 20, hasNext: false, nextCursor: null },
}

export const OFFLINE_MUSIC_SERVICES = {
	services: [],
	youtubeConnectionStatus: null,
}

export const OFFLINE_ADMIN_AUDIO_QUEUE = {
	workerState: {
		status: 'unknown',
		currentlyProcessing: null,
		lastQueueRun: null,
		nextLongBreakAt: null,
		lastStateChange: new Date().toISOString(),
	},
	queueStats: {
		pending: 0,
		processing: 0,
		completed: 0,
		failed: 0,
		total: 0,
		successRate: 0,
	},
	jobs: [],
	currentlyProcessingTrack: null,
	filter: 'all' as const,
	page: 1,
	totalPages: 1,
}

export const OFFLINE_YOUTUBE_PLAYLISTS = {
	playlists: [],
	hasConnection: false,
	service: null,
}

export const OFFLINE_YOUTUBE_SYNCED = {
	playlists: [],
}

export const OFFLINE_YOUTUBE_INDEX = {
	syncedPlaylists: [],
	hasConnection: false,
}

export const OFFLINE_PASSKEYS = {
	passkeys: [],
}

export function offlineYoutubePlaylistFallback(playlistId: string) {
	return {
		playlist: {
			id: playlistId,
			title: 'Offline',
			description: null,
			externalId: '',
			serviceId: '',
			ownerId: '',
			createdAt: new Date(),
			updatedAt: new Date(),
		},
		tracks: [],
	}
}

export function offlineTrackDetailFallback(trackId: string) {
	return {
		track: {
			id: trackId,
			title: 'Offline',
			artist: { id: '', name: '' },
			duration: null,
			coverImage: null,
			audioFiles: [],
			createdAt: new Date(),
			updatedAt: new Date(),
		},
	}
}
