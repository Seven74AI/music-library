import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { type FullTrack } from '#app/types/frontend/shared.ts'
import {
	collectHydrationIds,
	collectQueueDisplayHydrationIds,
	hydratePlaybackCacheInBatches,
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

	test('returns at most lookahead tracks when no current track', () => {
		const ids = collectHydrationIds(
			{
				upNext: [{ id: 'u1', title: 'U1', artist: { id: 'a', name: 'A' } }],
				spine: [
					{ id: 's1', title: 'S1', artist: { id: 'a', name: 'A' } },
					{ id: 's2', title: 'S2', artist: { id: 'a', name: 'A' } },
					{ id: 's3', title: 'S3', artist: { id: 'a', name: 'A' } },
					{ id: 's4', title: 'S4', artist: { id: 'a', name: 'A' } },
					{ id: 's5', title: 'S5', artist: { id: 'a', name: 'A' } },
				],
				spineOrder: [0, 1, 2, 3, 4],
				spinePosition: 0,
				loopMode: 'off',
			},
			null,
		)

		expect(ids).toHaveLength(4) // lookahead = 4
	})

	test('early-terminates on large queues without materializing full array', () => {
		// Simulate a 15K+ library: one upNext + 15K spine tracks
		const largeSpine = Array.from({ length: 15_000 }, (_, i) => ({
			id: `s${i}`,
			title: `Track ${i}`,
			artist: { id: 'a', name: 'A' },
		}))

		const ids = collectHydrationIds(
			{
				upNext: [{ id: 'u0', title: 'UpNext', artist: { id: 'a', name: 'A' } }],
				spine: largeSpine,
				spineOrder: Array.from({ length: 15_000 }, (_, i) => i),
				spinePosition: 0,
				loopMode: 'off',
			},
			null,
		)

		// Should only return lookahead (4) tracks, not 15K
		expect(ids).toHaveLength(4)
		expect(ids).toEqual(['u0', 's0', 's1', 's2'])
	})
})

describe('collectQueueDisplayHydrationIds', () => {
	test('includes now playing, Up Next, and upcoming spine without a lookahead cap', () => {
		const ids = collectQueueDisplayHydrationIds(
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

describe('hydratePlaybackCacheInBatches', () => {
	test('fetches playback data in a single batch for small lists', async () => {
		const fetchMock = vi.mocked(fetch)
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ tracks: [] }),
		} as Response)

		const cache = new PlaybackHydrationCache()
		const ids = Array.from({ length: 25 }, (_, index) => `track-${index}`)

		const updated = await hydratePlaybackCacheInBatches(cache, ids)

		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(updated).toBe(0)
	})

	test('splits into multiple batches when exceeding PLAYBACK_BATCH_MAX_IDS', async () => {
		const fetchMock = vi.mocked(fetch)
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ tracks: [] }),
		} as Response)

		const cache = new PlaybackHydrationCache()
		const ids = Array.from({ length: 250 }, (_, index) => `track-${index}`)

		const updated = await hydratePlaybackCacheInBatches(cache, ids)

		expect(fetchMock).toHaveBeenCalledTimes(2)
		expect(updated).toBe(0)
	})

	test('refetches cached stubs missing cover art when refetchIncomplete is set', async () => {
		const fetchMock = vi.mocked(fetch)
		const cache = new PlaybackHydrationCache()
		cache.set({
			...fullTrack,
			id: 'track-1',
			coverImage: null,
		})

		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({
				tracks: [{ ...fullTrack, id: 'track-1', coverImage: { objectKey: 'covers/1.jpg' } }],
			}),
		} as Response)

		const updated = await hydratePlaybackCacheInBatches(cache, ['track-1'], {
			refetchIncomplete: true,
		})

		expect(updated).toBe(1)
		expect(cache.get('track-1')?.coverImage).toEqual({ objectKey: 'covers/1.jpg' })
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
