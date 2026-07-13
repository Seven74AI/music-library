import { afterEach, describe, expect, test, vi } from 'vitest'
import { getOfflineStorage } from '#app/features/offline-storage/offline-storage.client.ts'
import {
	OfflineDataCorruptedError,
	resolvePlaybackAudioUrl,
	resolveTrackPlaybackSource,
} from './resolve-playback-url.client.ts'

vi.mock('#app/features/offline-storage/offline-storage.client.ts', () => ({
	getOfflineStorage: vi.fn(),
}))

describe('resolvePlaybackAudioUrl', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	test('returns null when IndexedDB throws (IndexedDB/Blob errors)', async () => {
		vi.mocked(getOfflineStorage).mockReturnValue({
			resolvePlaybackBlob: vi.fn().mockRejectedValue(
				new Error('IndexedDB error'),
			),
		} as never)

		await expect(resolvePlaybackAudioUrl('track-1')).resolves.toBeNull()
	})
})

describe('resolveTrackPlaybackSource', () => {
	afterEach(() => {
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	test('returns offline blob URL immediately when available (offline-first)', async () => {
		const blob = new Blob(['audio'], { type: 'audio/mpeg' })
		vi.mocked(getOfflineStorage).mockReturnValue({
			resolvePlaybackBlob: vi.fn().mockResolvedValue(blob),
		} as never)
		const fetchSpy = vi.fn().mockRejectedValue(new Error('should not be called'))
		vi.stubGlobal('fetch', fetchSpy)

		const result = await resolveTrackPlaybackSource('track-1')

		expect(result).toMatch(/^blob:/)
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	test('falls back to remote fetch when no offline blob exists', async () => {
		vi.mocked(getOfflineStorage).mockReturnValue({
			resolvePlaybackBlob: vi.fn().mockResolvedValue(null),
		} as never)
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ url: 'https://cdn.example/track-1.mp3' }),
			}),
		)

		await expect(resolveTrackPlaybackSource('track-1')).resolves.toBe(
			'https://cdn.example/track-1.mp3',
		)
	})

	test('returns null when offline blob is missing and remote fetch fails', async () => {
		vi.mocked(getOfflineStorage).mockReturnValue({
			resolvePlaybackBlob: vi.fn().mockResolvedValue(null),
		} as never)
		vi.stubGlobal(
			'fetch',
			vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
		)

		await expect(resolveTrackPlaybackSource('track-1')).resolves.toBeNull()
	})

	test('returns null when remote fetch returns a non-ok response and no offline blob', async () => {
		vi.mocked(getOfflineStorage).mockReturnValue({
			resolvePlaybackBlob: vi.fn().mockResolvedValue(null),
		} as never)
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 404,
			}),
		)

		await expect(resolveTrackPlaybackSource('track-1')).resolves.toBeNull()
	})

	test('prefers offline blob even when remote is available', async () => {
		const blob = new Blob(['audio'], { type: 'audio/mpeg' })
		vi.mocked(getOfflineStorage).mockReturnValue({
			resolvePlaybackBlob: vi.fn().mockResolvedValue(blob),
		} as never)
		const fetchSpy = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ url: 'https://cdn.example/track-1.mp3' }),
		})
		vi.stubGlobal('fetch', fetchSpy)

		const result = await resolveTrackPlaybackSource('track-1')

		expect(result).toMatch(/^blob:/)
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	test('throws OfflineDataCorruptedError when preferOffline is set and no offline data', async () => {
		vi.mocked(getOfflineStorage).mockReturnValue({
			resolvePlaybackBlob: vi.fn().mockResolvedValue(null),
		} as never)

		await expect(
			resolveTrackPlaybackSource('track-1', { preferOffline: true }),
		).rejects.toThrow(OfflineDataCorruptedError)
	})

	test('throws OfflineDataCorruptedError when preferOffline is set and IndexedDB throws', async () => {
		vi.mocked(getOfflineStorage).mockReturnValue({
			resolvePlaybackBlob: vi.fn().mockRejectedValue(
				new Error('IndexedDB error'),
			),
		} as never)

		await expect(
			resolveTrackPlaybackSource('track-1', { preferOffline: true }),
		).rejects.toThrow(OfflineDataCorruptedError)
	})
})
