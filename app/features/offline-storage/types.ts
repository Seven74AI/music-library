import { type FullTrack } from '#app/types/frontend/shared'

export const OFFLINE_DB_NAME = 'music-library-offline'
export const OFFLINE_DB_VERSION = 1
export const OFFLINE_TRACKS_STORE = 'tracks'

/** User explicitly downloaded — never LRU-evicted automatically. */
export type OfflinePinSource = 'pinned' | 'queue'

export type OfflineTrackRecord = {
	trackId: string
	title: string
	artistId: string
	artistName: string
	duration: number | null
	coverObjectKey: string | null
	opfsPath: string
	/** True when the user tapped download (track or playlist bulk). */
	isPinned: boolean
	/** True when auto-cached from the active queue. */
	isQueueCached: boolean
	fileSizeBytes: number
	lastAccessedAt: number
	pinnedAt: number | null
	playlistIds: string[]
}

export type OfflineTrackSummary = Pick<
	OfflineTrackRecord,
	| 'trackId'
	| 'title'
	| 'artistId'
	| 'artistName'
	| 'duration'
	| 'coverObjectKey'
	| 'isPinned'
	| 'isQueueCached'
	| 'fileSizeBytes'
	| 'lastAccessedAt'
>

export function toOfflineTrackRecord(
	track: FullTrack,
	options: {
		opfsPath: string
		fileSizeBytes: number
		isPinned: boolean
		isQueueCached: boolean
		playlistId?: string
	},
): OfflineTrackRecord {
	const now = Date.now()
	const playlistIds = options.playlistId ? [options.playlistId] : []

	return {
		trackId: track.id,
		title: track.title,
		artistId: track.artist.id,
		artistName: track.artist.name,
		duration: track.duration,
		coverObjectKey: track.coverImage?.objectKey ?? null,
		opfsPath: options.opfsPath,
		isPinned: options.isPinned,
		isQueueCached: options.isQueueCached,
		fileSizeBytes: options.fileSizeBytes,
		lastAccessedAt: now,
		pinnedAt: options.isPinned ? now : null,
		playlistIds,
	}
}

export function mergeOfflineTrackRecord(
	existing: OfflineTrackRecord,
	update: Partial<
		Pick<
			OfflineTrackRecord,
			'isPinned' | 'isQueueCached' | 'fileSizeBytes' | 'lastAccessedAt' | 'pinnedAt'
		>
	> & { playlistId?: string },
): OfflineTrackRecord {
	const playlistIds = update.playlistId
		? [...new Set([...existing.playlistIds, update.playlistId])]
		: existing.playlistIds

	return {
		...existing,
		...update,
		isPinned: update.isPinned ?? existing.isPinned,
		isQueueCached: update.isQueueCached ?? existing.isQueueCached,
		pinnedAt:
			update.pinnedAt ??
			(update.isPinned && !existing.isPinned ? Date.now() : existing.pinnedAt),
		playlistIds,
	}
}
