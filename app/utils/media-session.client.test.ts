import { expect, test } from 'vitest'
import { buildMediaSessionMetadata } from './media-session.client.ts'

test('buildMediaSessionMetadata uses track title and artist', () => {
	const metadata = buildMediaSessionMetadata({
		id: 'track-1',
		title: 'Test Song',
		artist: { id: 'artist-1', name: 'Test Artist' },
		duration: 180,
		coverImage: null,
		audioFiles: [],
	})

	expect(metadata.title).toBe('Test Song')
	expect(metadata.artist).toBe('Test Artist')
	expect(metadata.artwork).toEqual([])
})

test('buildMediaSessionMetadata includes cover artwork when available', () => {
	const metadata = buildMediaSessionMetadata({
		id: 'track-1',
		title: 'Test Song',
		artist: { id: 'artist-1', name: 'Test Artist' },
		duration: 180,
		coverImage: { objectKey: 'images/tracks/1/cover.jpg' },
		audioFiles: [],
	})

	expect(metadata.artwork[0]?.src).toContain('/resources/images')
})
