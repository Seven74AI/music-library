import {
	OFFLINE_ADMIN_AUDIO_QUEUE,
	OFFLINE_EMPTY,
	OFFLINE_MUSIC_SERVICES,
	OFFLINE_PASSKEYS,
	OFFLINE_SEARCH,
	OFFLINE_YOUTUBE_INDEX,
	OFFLINE_YOUTUBE_PLAYLISTS,
	OFFLINE_YOUTUBE_SYNCED,
	offlineTrackDetailFallback,
	offlineYoutubePlaylistFallback,
} from '#app/utils/offline-route-fallbacks.client.ts'

export type OfflineMiddlewareFallback =
	| { kind: 'empty' }
	| { kind: 'constant'; value: unknown }
	| {
			kind: 'pathname'
			segmentIndex: number
			fn: (value: string) => unknown
	  }

/** Routes with their own offline-aware clientLoader — middleware must not patch these. */
export const OFFLINE_SELF_MANAGED_ROUTE_IDS = new Set([
	'root',
	'routes/_marketing+/index',
	'routes/library.index',
	'routes/downloads',
	'routes/playlists',
	'routes/playlists.index',
	'routes/playlists.new',
	'routes/playlists.$playlistId',
])

export const OFFLINE_MIDDLEWARE_SKIP_PREFIXES = [
	'routes/resources+/',
	'routes/api+/',
	'routes/_auth+/',
]

export const OFFLINE_REDIRECTS: Array<{
	matchPathname: (pathname: string) => boolean
	to: string
}> = [
	{ matchPathname: (pathname) => pathname === '/me', to: '/downloads' },
	{
		matchPathname: (pathname) =>
			pathname === '/music/services/youtube/auth' ||
			pathname.startsWith('/music/services/youtube/callback'),
		to: '/music/services',
	},
]

export const OFFLINE_ROUTE_FALLBACKS: Record<string, OfflineMiddlewareFallback> = {
	'routes/search': { kind: 'constant', value: OFFLINE_SEARCH },
	'routes/music+/services+/index': {
		kind: 'constant',
		value: OFFLINE_MUSIC_SERVICES,
	},
	'routes/library.$trackId': {
		kind: 'pathname',
		segmentIndex: 2,
		fn: offlineTrackDetailFallback,
	},
	'routes/admin+/audio-queue': {
		kind: 'constant',
		value: OFFLINE_ADMIN_AUDIO_QUEUE,
	},
	'routes/music+/services+/youtube+/index': {
		kind: 'constant',
		value: OFFLINE_YOUTUBE_INDEX,
	},
	'routes/music+/services+/youtube+/playlists': {
		kind: 'constant',
		value: OFFLINE_YOUTUBE_PLAYLISTS,
	},
	'routes/music+/services+/youtube+/synced-playlists': {
		kind: 'constant',
		value: OFFLINE_YOUTUBE_SYNCED,
	},
	'routes/music+/services+/youtube+/playlist.$id': {
		kind: 'pathname',
		segmentIndex: 5,
		fn: offlineYoutubePlaylistFallback,
	},
	'routes/settings+/profile.passkeys': {
		kind: 'constant',
		value: OFFLINE_PASSKEYS,
	},
}

export function shouldSkipOfflineMiddlewareRoute(routeId: string) {
	if (OFFLINE_SELF_MANAGED_ROUTE_IDS.has(routeId)) return true
	return OFFLINE_MIDDLEWARE_SKIP_PREFIXES.some((prefix) =>
		routeId.startsWith(prefix),
	)
}

export function resolveOfflineFallbackForRoute(routeId: string, request: Request) {
	const entry = OFFLINE_ROUTE_FALLBACKS[routeId]
	if (!entry) return OFFLINE_EMPTY

	if (entry.kind === 'empty') return OFFLINE_EMPTY
	if (entry.kind === 'constant') return entry.value

	const segment = new URL(request.url).pathname.split('/').at(entry.segmentIndex) ?? ''
	return entry.fn(segment)
}

export function getOfflineRedirectTarget(request: Request) {
	const pathname = new URL(request.url).pathname
	return OFFLINE_REDIRECTS.find((entry) => entry.matchPathname(pathname))?.to
}
