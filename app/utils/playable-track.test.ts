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
		expect(isPlayableTrack({ id: 'track-4' })).toBe(false)
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
