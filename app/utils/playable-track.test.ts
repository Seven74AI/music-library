import { describe, expect, test } from 'vitest'
import { filterPlayableTracks, isPlayableTrack } from './playable-track'

const playable = {
	id: 'track-1',
	audioFiles: [{ id: 'af-1', format: 'mp3', objectKey: 'audio/test.mp3' }],
}

const metadataOnly = {
	id: 'track-2',
	audioFiles: [],
}

const deletedWithAudio = {
	id: 'track-3',
	isDeleted: true,
	audioFiles: [{ id: 'af-2', format: 'mp3', objectKey: 'audio/deleted.mp3' }],
}

describe('isPlayableTrack', () => {
	test('returns true when track has audio files and is not deleted', () => {
		expect(isPlayableTrack(playable)).toBe(true)
	})

	test('returns false when audioFiles is empty', () => {
		expect(isPlayableTrack(metadataOnly)).toBe(false)
	})

	test('returns false when audioFiles is missing', () => {
		expect(isPlayableTrack({})).toBe(false)
	})

	test('returns false when track is deleted', () => {
		expect(isPlayableTrack(deletedWithAudio)).toBe(false)
	})
})

describe('filterPlayableTracks', () => {
	test('keeps only playable tracks', () => {
		expect(filterPlayableTracks([playable, metadataOnly, deletedWithAudio])).toEqual([playable])
	})
})

describe('edge cases: audioFiles with empty objectKey or null entries', () => {
	test('treats track with empty objectKey audioFiles entry as playable', () => {
		// isPlayableTrack only checks audioFiles.length > 0 — individual entry
		// validity (empty objectKey) is not validated here. This test documents
		// the current contract.
		const emptyKey = {
			id: 'track-empty-key',
			audioFiles: [{ id: 'af-e1', format: 'mp3', objectKey: '' }],
		}
		expect(isPlayableTrack(emptyKey)).toBe(true)
	})

	test('treats track with null format in audioFiles as playable', () => {
		// isPlayableTrack only checks audioFiles.length — null format entries
		// still count toward the length. This test documents the current contract.
		const nullFormat = {
			id: 'track-null-format',
			audioFiles: [{ id: 'af-n1', format: null, objectKey: 'audio/nullfmt.mp3' }],
		}
		expect(isPlayableTrack(nullFormat)).toBe(true)
	})
})
