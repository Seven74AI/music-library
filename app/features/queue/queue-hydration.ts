import { type FullTrack, type QueueTrack } from '#app/types/frontend/shared.ts'
import { getSpinePlayOrder, type QueueNavigationState } from './queue-navigation.ts'
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

	async hydrateMissing(ids: string[]): Promise<void> {
		const missingIds = ids.filter(id => !this.cache.has(id))
		if (missingIds.length === 0) return

		const tracks = await fetchPlaybackBatch(missingIds)
		for (const track of tracks) {
			this.cache.set(track.id, track)
		}
	}
}

export function collectHydrationIds(
	state: QueueNavigationState,
	currentTrackId: string | null,
	lookahead: number = PLAYBACK_LOOKAHEAD,
): string[] {
	const ids: string[] = []

	if (currentTrackId) ids.push(currentTrackId)

	for (const track of state.upNext) {
		ids.push(track.id)
	}

	for (const track of getSpinePlayOrder(state)) {
		ids.push(track.id)
	}

	return [...new Set(ids)].slice(0, lookahead + (currentTrackId ? 1 : 0))
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
