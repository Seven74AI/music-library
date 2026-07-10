import { describe, expect, test, beforeEach, vi } from 'vitest'
import { createMemoryOfflineAudioStore } from './memory-audio-store.ts'
import { createOfflineMetadataStore } from './metadata-store.client.ts'
import { createOfflineStorage } from './offline-storage.client.ts'

/**
 * @vitest-environment jsdom
 */
import 'fake-indexeddb/auto'

const track = {
	id: 'track-1',
	title: 'Offline Song',
	artist: { id: 'artist-1', name: 'Artist' },
	duration: 210,
	coverImage: null,
	audioFiles: [{ id: 'af-1', format: 'mp3', objectKey: 'k' }],
}

describe('createOfflineStorage', () => {
	beforeEach(async () => {
		const metadataStore = createOfflineMetadataStore()
		await metadataStore.clear()
	})

	test('downloads and resolves pinned playback blobs', async () => {
		const audioStore = createMemoryOfflineAudioStore()
		const metadataStore = createOfflineMetadataStore()
		const storage = createOfflineStorage({
			audioStore,
			metadataStore,
			fetchAudioBytes: async () => new Uint8Array([1, 2, 3]).buffer,
			requestPersistentStorage: async () => {},
			readStorageEstimate: async () => ({ usage: 0, quota: 1_000_000_000 }),
		})

		await storage.downloadTrack(track, { pin: true })
		expect(await storage.hasTrack(track.id)).toBe(true)

		const blob = await storage.resolvePlaybackBlob(track.id)
		expect(blob).not.toBeNull()
		expect((await blob!.arrayBuffer()).byteLength).toBe(3)
	})

	test('default fetch uses same-origin stream route', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			arrayBuffer: async () => new Uint8Array([9, 8, 7]).buffer,
		})
		vi.stubGlobal('fetch', fetchMock)

		const audioStore = createMemoryOfflineAudioStore()
		const metadataStore = createOfflineMetadataStore()
		const storage = createOfflineStorage({
			audioStore,
			metadataStore,
			requestPersistentStorage: async () => {},
			readStorageEstimate: async () => ({ usage: 0, quota: 1_000_000_000 }),
		})

		await storage.downloadTrack(track, { pin: true })

		expect(fetchMock).toHaveBeenCalledWith('/resources/audio/track-1?stream=1', {
			credentials: 'same-origin',
		})

		vi.unstubAllGlobals()
	})

	test('evicts queue-only tracks before pinned ones when quota is tight', async () => {
		const audioStore = createMemoryOfflineAudioStore()
		const metadataStore = createOfflineMetadataStore()
		const storage = createOfflineStorage({
			audioStore,
			metadataStore,
			fetchAudioBytes: async (trackId) =>
				new Uint8Array(trackId === 'track-1' ? 500_000 : 400_000).buffer,
			requestPersistentStorage: async () => {},
			readStorageEstimate: async () => ({ usage: 900_000, quota: 1_000_000 }),
		})

		await storage.downloadTrack(
			{ ...track, id: 'queue-track', title: 'Queue' },
			{ pin: false },
		)
		await storage.downloadTrack(track, { pin: true })

		expect(await storage.hasTrack('queue-track')).toBe(false)
		expect(await storage.hasTrack('track-1')).toBe(true)
	})
})
