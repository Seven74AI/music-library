import { describe, expect, test } from 'vitest'
import { filterOrphanedTracks } from './batch-processor.server'

describe('filterOrphanedTracks', () => {
	test('returns tracks missing from the current sync that are not deleted or claimed', () => {
		const processedExternalIds = new Set(['video-1'])
		const processedTrackIds = new Set<string>()
		const pendingMatches = [
			{
				deletedVideo: { position: 1, itemId: 'item-1', title: 'Deleted', snippet: undefined },
				candidateTracks: [
					{
						id: 'claimed-track',
						title: 'Claimed',
						artist: 'Artist',
						externalId: 'video-claimed',
						position: 3,
						isDeleted: false,
					},
				],
			},
		]

		const orphaned = filterOrphanedTracks(
			[
				{
					position: 1,
					isDeleted: false,
					track: {
						id: 'track-1',
						title: 'Synced',
						artist: { id: 'artist-1', name: 'Artist' },
						externalId: 'video-1',
					},
				},
				{
					position: 2,
					isDeleted: false,
					track: {
						id: 'track-2',
						title: 'Orphan',
						artist: { id: 'artist-2', name: 'Other Artist' },
						externalId: 'video-2',
					},
				},
				{
					position: 3,
					isDeleted: false,
					track: {
						id: 'claimed-track',
						title: 'Claimed',
						artist: { id: 'artist-3', name: 'Artist' },
						externalId: 'video-claimed',
					},
				},
				{
					position: 4,
					isDeleted: true,
					track: {
						id: 'track-4',
						title: 'Already deleted',
						artist: null,
						externalId: 'video-4',
					},
				},
			],
			processedExternalIds,
			processedTrackIds,
			pendingMatches,
		)

		expect(orphaned).toEqual([
			{
				id: 'track-2',
				title: 'Orphan',
				artist: 'Other Artist',
				externalId: 'video-2',
				position: 2,
				isDeleted: false,
			},
		])
	})
})
