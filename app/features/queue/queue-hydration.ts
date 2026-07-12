import { type FullTrack, type QueueTrack } from '#app/types/frontend/shared.ts'
import {
	getQueueSpineDisplayTracks,
	getSpinePlayOrder,
	type QueueNavigationState,
} from './queue-navigation.ts'
import { fullTrackStubFromQueueTrack } from './queue-spine.ts'

export const PLAYBACK_LOOKAHEAD = 4
export const PLAYBACK_BATCH_MAX_IDS = 20

export type PlaybackBatchResponse = {
	tracks: FullTrack[]
}

export async function fetchPlaybackBatch(ids: string[]): Promise<FullTrack[]> {
	if (ids.length === 0) return []

	const uniqueIds = [...new Set(ids)].slice(0, PLAYBACK_BATCH_MAX_IDS)
	const response = await fetch(
		`/api/tracks/playback?ids=${encodeURIComponent(uniqueIds.join(','))}`,
	)

	if (!response.ok) {
		throw new Error(`Failed to fetch playback tracks: ${response.status}`)
	}

	const data = (await response.json()) as PlaybackBatchResponse
	return data.tracks
}

export class PlaybackHydrationCache {
	private readonly cache = new Map<string, FullTrack>()

	get(trackId: string): FullTrack | undefined {
		return this.cache.get(trackId)
	}

	set(track: FullTrack): void {
		this.cache.set(track.id, track)
	}

	has(trackId: string): boolean {
		return this.cache.has(trackId)
	}

	clear(): void {
		this.cache.clear()
	}

	toMap(): Map<string, FullTrack> {
		return new Map(this.cache)
	}

	async hydrateMissing(
		ids: string[],
		options?: { refetchIncomplete?: boolean },
	): Promise<number> {
		const targetIds = ids.filter(id => {
			if (!this.cache.has(id)) return true
			if (options?.refetchIncomplete) {
				return !this.cache.get(id)?.coverImage
			}
			return false
		})
		if (targetIds.length === 0) return 0

		const tracks = await fetchPlaybackBatch(targetIds)
		for (const track of tracks) {
			this.cache.set(track.id, track)
		}
		return tracks.length
	}
}

export function collectHydrationIds(
	state: QueueNavigationState,
	currentTrackId: string | null,
	lookahead: number = PLAYBACK_LOOKAHEAD,
): string[] {
	const target = lookahead + (currentTrackId ? 1 : 0)
	const seen = new Set<string>()
	const ids: string[] = []

	function tryAdd(id: string): boolean {
		if (seen.has(id)) return false
		seen.add(id)
		ids.push(id)
		return ids.length >= target
	}

	if (currentTrackId && tryAdd(currentTrackId)) return ids

	for (const track of state.upNext) {
		if (tryAdd(track.id)) return ids
	}

	for (const track of getSpinePlayOrder(state)) {
		if (tryAdd(track.id)) return ids
	}

	return ids
}

/** All track IDs shown in the queue sheet (no playback lookahead cap). */
export function collectQueueDisplayHydrationIds(
	state: QueueNavigationState,
	currentTrackId: string | null,
): string[] {
	const ids: string[] = []

	if (currentTrackId) ids.push(currentTrackId)

	for (const track of state.upNext) {
		ids.push(track.id)
	}

	for (const track of getQueueSpineDisplayTracks(state, currentTrackId !== null)) {
		ids.push(track.id)
	}

	return [...new Set(ids)]
}

export async function hydratePlaybackCacheInBatches(
	cache: PlaybackHydrationCache,
	ids: string[],
	options?: { refetchIncomplete?: boolean },
): Promise<number> {
	const uniqueIds = [...new Set(ids)]
	let updated = 0
	for (let index = 0; index < uniqueIds.length; index += PLAYBACK_BATCH_MAX_IDS) {
		updated += await cache.hydrateMissing(
			uniqueIds.slice(index, index + PLAYBACK_BATCH_MAX_IDS),
			options,
		)
	}
	return updated
}

export function resolveFullTrack(
	cache: PlaybackHydrationCache,
	track: QueueTrack,
): FullTrack {
	return cache.get(track.id) ?? fullTrackStubFromQueueTrack(track)
}

export function resolveFullTracks(
	cache: PlaybackHydrationCache,
	tracks: QueueTrack[],
): FullTrack[] {
	return tracks.map(track => resolveFullTrack(cache, track))
}
