import { describe, expect, test, vi, afterEach } from 'vitest'
import {
	buildMediaSessionMetadata,
	clearMediaSessionPositionState,
	clampMediaSessionSeekTime,
	isMediaSessionSupported,
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

test('buildMediaSessionMetadata includes multiple artwork sizes when cover is available', () => {
	const metadata = buildMediaSessionMetadata({
		id: 'track-1',
		title: 'Test Song',
		artist: { id: 'artist-1', name: 'Test Artist' },
		duration: 180,
		coverImage: { objectKey: 'images/tracks/1/cover.jpg' },
		audioFiles: [],
	})

	expect(metadata.artwork).toHaveLength(6)
	expect(metadata.artwork.map((entry) => entry.sizes)).toEqual([
		'96x96',
		'128x128',
		'192x192',
		'256x256',
		'384x384',
		'512x512',
	])
	expect(metadata.artwork.every((entry) => entry.src.includes('/resources/images'))).toBe(
		true,
	)
	expect(metadata.artwork[0]?.src).toContain('w=96')
	expect(metadata.artwork.at(-1)?.src).toContain('w=512')
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

describe('SSR safety (no navigator / MediaMetadata)', () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	test('isMediaSessionSupported returns false when navigator is undefined', () => {
		vi.stubGlobal('navigator', undefined)
		expect(isMediaSessionSupported()).toBe(false)
	})

	test('updateMediaSessionPositionState returns early when navigator is undefined', () => {
		vi.stubGlobal('navigator', undefined)
		// Should not throw
		expect(() =>
			updateMediaSessionPositionState({
				duration: 120,
				currentTime: 30,
				playbackRate: 1,
			}),
		).not.toThrow()
	})

	test('clearMediaSessionPositionState returns early when navigator is undefined', () => {
		vi.stubGlobal('navigator', undefined)
		expect(() => clearMediaSessionPositionState()).not.toThrow()
	})

	test('buildMediaSessionMetadata works without MediaMetadata constructor', () => {
		// MediaMetadata constructor does not exist in SSR (it is a browser-only API).
		// buildMediaSessionMetadata returns a plain object — no constructor dependency.
		const metadata = buildMediaSessionMetadata({
			id: 'track-ssr',
			title: 'SSR Song',
			artist: { id: 'artist-ssr', name: 'SSR Artist' },
			duration: 200,
			coverImage: null,
			audioFiles: [],
		})
		expect(metadata.title).toBe('SSR Song')
		expect(metadata.artist).toBe('SSR Artist')
		expect(metadata.artwork).toEqual([])
	})
})
