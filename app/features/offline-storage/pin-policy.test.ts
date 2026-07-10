import { describe, expect, test } from 'vitest'
import {
	isProtectedOfflineTrack,
	selectQueueCacheEvictionCandidates,
	shouldRemoveRecordAfterEviction,
} from './pin-policy.ts'
import { type OfflineTrackRecord } from './types.ts'

function record(
	overrides: Partial<OfflineTrackRecord> & Pick<OfflineTrackRecord, 'trackId'>,
): OfflineTrackRecord {
	return {
		title: 'Title',
		artistId: 'artist-1',
		artistName: 'Artist',
		duration: 180,
		coverObjectKey: null,
		opfsPath: `audio/${overrides.trackId}.mp3`,
		isPinned: false,
		isQueueCached: true,
		fileSizeBytes: 1_000_000,
		lastAccessedAt: 0,
		pinnedAt: null,
		playlistIds: [],
		...overrides,
	}
}

describe('isProtectedOfflineTrack', () => {
	test('pinned tracks are protected', () => {
		expect(isProtectedOfflineTrack(record({ trackId: 'a', isPinned: true }))).toBe(
			true,
		)
	})

	test('queue-only tracks are not protected', () => {
		expect(
			isProtectedOfflineTrack(
				record({ trackId: 'a', isPinned: false, isQueueCached: true }),
			),
		).toBe(false)
	})
})

describe('selectQueueCacheEvictionCandidates', () => {
	test('evicts least recently used queue-only tracks first', () => {
		const candidates = selectQueueCacheEvictionCandidates(
			[
				record({ trackId: 'old', lastAccessedAt: 1, fileSizeBytes: 2_000_000 }),
				record({ trackId: 'new', lastAccessedAt: 99, fileSizeBytes: 2_000_000 }),
				record({
					trackId: 'pinned',
					isPinned: true,
					lastAccessedAt: 0,
					fileSizeBytes: 9_000_000,
				}),
			],
			3_000_000,
		)

		expect(candidates.map((t) => t.trackId)).toEqual(['old', 'new'])
	})
})

describe('shouldRemoveRecordAfterEviction', () => {
	test('queue-only records are removed', () => {
		expect(
			shouldRemoveRecordAfterEviction(
				record({ trackId: 'a', isPinned: false, isQueueCached: true }),
			),
		).toBe(true)
	})

	test('pinned records stay even if queue-cached', () => {
		expect(
			shouldRemoveRecordAfterEviction(
				record({ trackId: 'a', isPinned: true, isQueueCached: true }),
			),
		).toBe(false)
	})
})
