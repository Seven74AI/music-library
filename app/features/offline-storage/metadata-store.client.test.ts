/**
 * @vitest-environment jsdom
 */
import 'fake-indexeddb/auto'
import { describe, expect, test, beforeEach } from 'vitest'
import {
	type OfflineMetadataStore,
	createOfflineMetadataStore,
} from './metadata-store.client.ts'
import { toOfflineTrackRecord } from './types.ts'

const sampleTrack = {
	id: 'track-1',
	title: 'Song',
	artist: { id: 'artist-1', name: 'Artist' },
	duration: 200,
	coverImage: null,
	audioFiles: [{ id: 'af-1', format: 'mp3', objectKey: 'audio/x.mp3' }],
}

describe('OfflineMetadataStore', () => {
	let store: OfflineMetadataStore

	beforeEach(async () => {
		store = createOfflineMetadataStore()
		await store.clear()
	})

	test('puts and lists offline tracks', async () => {
		await store.put(
			toOfflineTrackRecord(sampleTrack, {
				opfsPath: 'audio/track-1.mp3',
				fileSizeBytes: 1234,
				isPinned: true,
				isQueueCached: false,
			}),
		)

		const tracks = await store.list()
		expect(tracks).toHaveLength(1)
		expect(tracks[0]?.trackId).toBe('track-1')
		expect(tracks[0]?.isPinned).toBe(true)
	})

	test('filters pinned tracks for offline library view', async () => {
		await store.put(
			toOfflineTrackRecord(sampleTrack, {
				opfsPath: 'audio/track-1.mp3',
				fileSizeBytes: 100,
				isPinned: true,
				isQueueCached: false,
			}),
		)
		await store.put(
			toOfflineTrackRecord(
				{ ...sampleTrack, id: 'track-2', title: 'Queue song' },
				{
					opfsPath: 'audio/track-2.mp3',
					fileSizeBytes: 100,
					isPinned: false,
					isQueueCached: true,
				},
			),
		)

		expect(await store.listPinned()).toHaveLength(1)
		expect(await store.listDownloaded()).toHaveLength(2)
	})
})
