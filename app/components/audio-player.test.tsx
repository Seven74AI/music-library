/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { type ReactNode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import  { type FullTrack } from '#app/types/frontend/shared'
import { AudioPlayer } from './audio-player'

vi.mock('#app/components/ui/use-toast.ts', () => ({
	toast: vi.fn(),
}))

// Mock the provider module to avoid the QueueSheet's useAudioPlayer requirement
vi.mock('#app/components/audio-player-provider', () => ({
	useAudioPlayer: () => ({
		playlist: [],
		currentTrack: null,
		currentIndex: -1,
		removeTrackFromPlaylist: vi.fn(),
	}),
	AudioPlayerProvider: ({ children }: { children: ReactNode }) => children,
}))

const mockTrack: FullTrack = {
	id: 'track-1',
	title: 'Test Song',
	artist: { id: 'artist-1', name: 'Test Artist' },
	duration: 180,
	coverImage: { objectKey: 'covers/test.jpg' },
	audioFiles: [{ id: 'af-1', format: 'mp3', objectKey: 'audio/test.mp3' }],
}

const defaultProps = {
	track: mockTrack,
	isVisible: true,
	onClose: vi.fn(),
	onNext: vi.fn(),
	onPrevious: vi.fn(),
	onToggleLoop: vi.fn(),
	onToggleShuffle: vi.fn(),
	hasNext: false,
	hasPrevious: false,
	loopMode: 'off' as const,
	isShuffleEnabled: false,
	playbackToken: 0,
	wantsAutoPlayRef: { current: false },
}

test('logs MediaError.code to console.error when <audio> fires error event', () => {
	const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

	const { container } = render(<AudioPlayer {...defaultProps} />)

	const audioEl = container.querySelector('audio')
	expect(audioEl).not.toBeNull()

	// Simulate a MediaError on the audio element
	// MediaError codes: 1=MEDIA_ERR_ABORTED, 2=MEDIA_ERR_NETWORK, 3=MEDIA_ERR_DECODE, 4=MEDIA_ERR_SRC_NOT_SUPPORTED
	Object.defineProperty(audioEl!, 'error', {
		configurable: true,
		value: { code: 4, message: 'MEDIA_ELEMENT_ERROR: Format error' },
	})

	// Dispatch the error event
	audioEl!.dispatchEvent(new Event('error'))

	// Assert console.error was called with the MediaError.code
	expect(consoleSpy).toHaveBeenCalledWith(
		'Audio load error: MEDIA_ELEMENT_ERROR: Format error (code: 4)',
	)

	consoleSpy.mockRestore()
})

test('does not log when audio error is null (element exists but no MediaError)', () => {
	const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

	const { container } = render(<AudioPlayer {...defaultProps} />)

	const audioEl = container.querySelector('audio')
	expect(audioEl).not.toBeNull()

	// No error property set — error event without MediaError should not log
	audioEl!.dispatchEvent(new Event('error'))

	expect(consoleSpy).not.toHaveBeenCalled()

	consoleSpy.mockRestore()
})

test('calls onNext when audio ends and loopMode is off', () => {
	const onNext = vi.fn()

	const { container } = render(
		<AudioPlayer {...defaultProps} onNext={onNext} loopMode="off" />,
	)

	const audioEl = container.querySelector('audio')
	expect(audioEl).not.toBeNull()

	audioEl!.dispatchEvent(new Event('ended'))

	expect(onNext).toHaveBeenCalledOnce()
})

test('does NOT call onNext when audio ends and loopMode is one', () => {
	const onNext = vi.fn()

	const { container } = render(
		<AudioPlayer {...defaultProps} onNext={onNext} loopMode="one" />,
	)

	const audioEl = container.querySelector('audio')
	expect(audioEl).not.toBeNull()

	audioEl!.dispatchEvent(new Event('ended'))

	expect(onNext).not.toHaveBeenCalled()
})

test('persists volume changes to localStorage', async () => {
	render(<AudioPlayer {...defaultProps} />)

	const volumeSlider = document.querySelector('[aria-label="Volume"]')
	expect(volumeSlider).not.toBeNull()
	if (!(volumeSlider instanceof HTMLInputElement)) {
		throw new TypeError('Expected volume control to be an HTMLInputElement')
	}

	fireEvent.change(volumeSlider, { target: { value: '0.4' } })

	await waitFor(() => {
		expect(window.localStorage.getItem('music-library:player-volume')).toBe('0.4')
	})
})

test('calls onNext when next button is clicked', () => {
	const onNext = vi.fn()

	render(
		<AudioPlayer {...defaultProps} onNext={onNext} hasNext={true} />,
	)

	const nextButton = document.querySelector('[aria-label="Next track"]')
	expect(nextButton).not.toBeNull()

	nextButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))

	expect(onNext).toHaveBeenCalledOnce()
})

test('calls onPrevious when previous button is clicked', () => {
	const onPrevious = vi.fn()

	render(
		<AudioPlayer {...defaultProps} onPrevious={onPrevious} hasPrevious={true} />,
	)

	const prevButton = document.querySelector('[aria-label="Previous track"]')
	expect(prevButton).not.toBeNull()

	prevButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))

	expect(onPrevious).toHaveBeenCalledOnce()
})

const mockTrack2: FullTrack = {
	...mockTrack,
	id: 'track-2',
	title: 'Second Song',
	audioFiles: [{ id: 'af-2', format: 'mp3', objectKey: 'audio/test2.mp3' }],
}

beforeEach(() => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input)
			const trackId = url.match(/\/resources\/audio\/([^/?]+)/)?.[1] ?? 'track-1'
			return {
				ok: true,
				json: async () => ({ url: `https://cdn.example/${trackId}.mp3` }),
			}
		}),
	)
})

afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
	window.localStorage.clear()
})

test('auto-plays after track change once the new audio URL has loaded', async () => {
	const wantsAutoPlayRef = { current: true }
	const playSpy = vi
		.spyOn(window.HTMLMediaElement.prototype, 'play')
		.mockImplementation(function (this: HTMLMediaElement) {
			Object.defineProperty(this, 'paused', { configurable: true, value: false })
			return Promise.resolve()
		})

	const { rerender } = render(
		<AudioPlayer
			{...defaultProps}
			playbackToken={1}
			wantsAutoPlayRef={wantsAutoPlayRef}
		/>,
	)

	await waitFor(() => {
		expect(playSpy).toHaveBeenCalled()
	})

	playSpy.mockClear()

	rerender(
		<AudioPlayer
			{...defaultProps}
			track={mockTrack2}
			playbackToken={2}
			wantsAutoPlayRef={wantsAutoPlayRef}
		/>,
	)

	await act(async () => {
		await Promise.resolve()
	})

	await waitFor(() => {
		expect(playSpy).toHaveBeenCalled()
		expect(wantsAutoPlayRef.current).toBe(false)
	})
})
