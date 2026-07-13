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

	test('tries remote playback even when navigator reports offline', async () => {
		vi.stubGlobal('navigator', { onLine: false })
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ url: 'https://cdn.example/track-1.mp3' }),
			}),
		)
		vi.mocked(getOfflineStorage).mockReturnValue({
			resolvePlaybackBlob: vi.fn().mockResolvedValue(null),
		} as never)

		await expect(resolveTrackPlaybackSource('track-1')).resolves.toBe(
			'https://cdn.example/track-1.mp3',
		)
	})

	test('falls back to offline blob when remote playback fails', async () => {
		vi.stubGlobal('navigator', { onLine: false })
		vi.stubGlobal(
			'fetch',
			vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
		)
		const blob = new Blob(['audio'], { type: 'audio/mpeg' })
		vi.mocked(getOfflineStorage).mockReturnValue({
			resolvePlaybackBlob: vi.fn().mockResolvedValue(blob),
		} as never)

		await expect(resolveTrackPlaybackSource('track-1')).resolves.toMatch(/^blob:/)
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
