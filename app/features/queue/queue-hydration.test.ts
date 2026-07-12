import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { type FullTrack } from '#app/types/frontend/shared.ts'
import {
	collectHydrationIds,
	PlaybackHydrationCache,
	resolveFullTrack,
} from './queue-hydration.ts'

const fullTrack: FullTrack = {
	id: 'track-1',
	title: 'Song',
	artist: { id: 'artist-1', name: 'Artist' },
	duration: 120,
	coverImage: null,
	audioFiles: [{ id: 'af-1', format: 'mp3', objectKey: 'audio/test.mp3' }],
}

beforeEach(() => {
	vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('PlaybackHydrationCache', () => {
	test('hydrateMissing fetches only uncached ids', async () => {
		const fetchMock = vi.mocked(fetch)
		fetchMock.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ tracks: [fullTrack] }),
		} as Response)

		const cache = new PlaybackHydrationCache()
		cache.set(fullTrack)

		await cache.hydrateMissing(['track-1', 'track-2'])

		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(String(fetchMock.mock.calls[0]?.[0])).toContain('ids=track-2')
		expect(cache.get('track-1')?.title).toBe('Song')
	})
})

describe('collectHydrationIds', () => {
	test('includes current track and lookahead from Up Next and spine', () => {
		const ids = collectHydrationIds(
			{
				upNext: [{ id: 'u1', title: 'U1', artist: { id: 'a', name: 'A' } }],
				spine: [
					{ id: 's1', title: 'S1', artist: { id: 'a', name: 'A' } },
					{ id: 's2', title: 'S2', artist: { id: 'a', name: 'A' } },
					{ id: 's3', title: 'S3', artist: { id: 'a', name: 'A' } },
				],
				spineOrder: [0, 1, 2],
				spinePosition: 0,
				loopMode: 'off',
			},
			's1',
		)

		expect(ids).toEqual(['s1', 'u1', 's2', 's3'])
	})
})

describe('resolveFullTrack', () => {
	test('returns cached track when available', () => {
		const cache = new PlaybackHydrationCache()
		cache.set(fullTrack)

		expect(
			resolveFullTrack(cache, {
				id: 'track-1',
				title: 'Song',
				artist: { id: 'artist-1', name: 'Artist' },
			}).audioFiles,
		).toHaveLength(1)
	})
})
