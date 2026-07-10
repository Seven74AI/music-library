import { describe, expect, test, vi, afterEach } from 'vitest'
import {
	buildMediaSessionMetadata,
	clearMediaSessionPositionState,
	clampMediaSessionSeekTime,
	updateMediaSessionPositionState,
} from './media-session.client.ts'

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

describe('updateMediaSessionPositionState', () => {
	const setPositionState = vi.fn()

	afterEach(() => {
		vi.unstubAllGlobals()
		setPositionState.mockReset()
	})

	function stubMediaSession() {
		vi.stubGlobal('navigator', {
			mediaSession: { setPositionState },
		})
	}

	test('updates lock screen position from audio element timing', () => {
		stubMediaSession()

		updateMediaSessionPositionState({
			duration: 120,
			currentTime: 30,
			playbackRate: 1,
		})

		expect(setPositionState).toHaveBeenCalledWith({
			duration: 120,
			position: 30,
			playbackRate: 1,
		})
	})

	test('skips update when duration is not ready', () => {
		stubMediaSession()

		updateMediaSessionPositionState({
			duration: Number.NaN,
			currentTime: 0,
			playbackRate: 1,
		})

		expect(setPositionState).not.toHaveBeenCalled()
	})

	test('clamps position to duration', () => {
		stubMediaSession()

		updateMediaSessionPositionState({
			duration: 120,
			currentTime: 150,
			playbackRate: 1,
		})

		expect(setPositionState).toHaveBeenCalledWith({
			duration: 120,
			position: 120,
			playbackRate: 1,
		})
	})

	test('clears position state', () => {
		stubMediaSession()

		clearMediaSessionPositionState()

		expect(setPositionState).toHaveBeenCalledWith()
	})
})

test('clampMediaSessionSeekTime keeps seek within track bounds', () => {
	expect(clampMediaSessionSeekTime(-5, 120)).toBe(0)
	expect(clampMediaSessionSeekTime(45, 120)).toBe(45)
	expect(clampMediaSessionSeekTime(200, 120)).toBe(120)
})
