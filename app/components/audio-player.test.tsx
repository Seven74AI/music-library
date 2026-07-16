/**
 * @vitest-environment jsdom
 *
 * AudioPlayer chrome tests (transport, volume, loading states).
 * Queue sheet behavior with real provider state is in audio-player-queue.integration.test.tsx.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ComponentProps, type ReactNode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useAudioPlayer } from '#app/components/audio-player-provider'
import  { type FullTrack } from '#app/types/frontend/shared'
import { AudioPlayer } from './audio-player'

type AudioPlayerTestProps = ComponentProps<typeof AudioPlayer>

const mockRemoveTrackFromPlaylist = vi.fn()

function createAudioPlayerMock(overrides: Record<string, unknown> = {}) {
	return {
		playlist: [],
		upNext: [],
		spine: [],
		spineTotal: 0,
		spinePosition: 0,
		currentTrack: null,
		currentIndex: -1,
		playContext: null,
		removeTrackFromPlaylist: mockRemoveTrackFromPlaylist,
		removeCurrentFromQueue: vi.fn(),
		startQueuePlayback: vi.fn(),
		hasQueuedPlayback: false,
		playNextTrack: vi.fn(),
		addToUpNext: vi.fn(),
		addToQueue: vi.fn(),
		...overrides,
	}
}

vi.mock('#app/components/ui/use-toast.ts', () => ({
	toast: vi.fn(),
}))

vi.mock('#app/components/track-details-dialog', () => ({
	TrackDetailsDialog: vi.fn(() => null),
}))

vi.mock('#app/features/offline-storage/resolve-playback-url.client.ts', () => ({
	resolveTrackPlaybackSource: vi.fn().mockResolvedValue('https://cdn.example/track-1.mp3'),
	revokePlaybackAudioUrl: vi.fn(),
	clearBlobUrlCache: vi.fn(),
}))

vi.mock('#app/components/audio-player-provider', () => ({
	useAudioPlayer: vi.fn(() => createAudioPlayerMock()),
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

const defaultProps: AudioPlayerTestProps = {
	track: mockTrack,
	isVisible: true,
	onClose: vi.fn(),
	onNext: vi.fn(),
	onPrevious: vi.fn(),
	onToggleLoop: vi.fn(),
	onToggleShuffle: vi.fn(),
	hasNext: false,
	hasPrevious: false,
	loopMode: 'off',
	isShuffleEnabled: false,
	playbackToken: 0,
	wantsAutoPlayRef: { current: false },
}

async function renderPlayer(props: Partial<AudioPlayerTestProps> = {}) {
	const view = render(<AudioPlayer {...defaultProps} {...props} />)
	const audioEl = await waitFor(() => {
		const element = view.container.querySelector('audio')
		if (!element) throw new Error('Audio element not mounted yet')
		return element
	})
	return { ...view, audioEl }
}

test('shows playback error with user-friendly message for MEDIA_ERR_ABORTED (code 1)', async () => {
	const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

	const { audioEl } = await renderPlayer()

	Object.defineProperty(audioEl, 'error', {
		configurable: true,
		value: { code: 1, message: 'The fetching was aborted by the user' },
	})

	audioEl.dispatchEvent(new Event('error'))

	// console.error still logged for debugging
	expect(consoleSpy).toHaveBeenCalledWith(
		'Audio load error: The fetching was aborted by the user (code: 1)',
	)

	await waitFor(() => {
		expect(screen.getByTestId('player-playback-error')).toBeInTheDocument()
		expect(screen.getByTestId('player-playback-error')).toHaveTextContent(
			'Playback was interrupted.',
		)
	})

	consoleSpy.mockRestore()
})

test('shows playback error with user-friendly message for MEDIA_ERR_NETWORK (code 2)', async () => {
	const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

	const { audioEl } = await renderPlayer()

	Object.defineProperty(audioEl, 'error', {
		configurable: true,
		value: { code: 2, message: 'A network error caused the audio download to fail' },
	})

	audioEl.dispatchEvent(new Event('error'))

	await waitFor(() => {
		expect(screen.getByTestId('player-playback-error')).toHaveTextContent(
			'A network error prevented the audio from loading. Check your connection.',
		)
	})

	consoleSpy.mockRestore()
})

test('shows playback error with user-friendly message for MEDIA_ERR_DECODE (code 3)', async () => {
	const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

	const { audioEl } = await renderPlayer()

	Object.defineProperty(audioEl, 'error', {
		configurable: true,
		value: { code: 3, message: 'The media is corrupted' },
	})

	audioEl.dispatchEvent(new Event('error'))

	await waitFor(() => {
		expect(screen.getByTestId('player-playback-error')).toHaveTextContent(
			'This audio format is not supported by your browser.',
		)
	})

	consoleSpy.mockRestore()
})

test('shows playback error with user-friendly message for MEDIA_ERR_SRC_NOT_SUPPORTED (code 4)', async () => {
	const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

	const { audioEl } = await renderPlayer()

	Object.defineProperty(audioEl, 'error', {
		configurable: true,
		value: { code: 4, message: 'The media resource is not supported' },
	})

	audioEl.dispatchEvent(new Event('error'))

	await waitFor(() => {
		expect(screen.getByTestId('player-playback-error')).toHaveTextContent(
			'The audio source could not be found or is not supported.',
		)
	})

	consoleSpy.mockRestore()
})

test('shows generic fallback message for unknown MediaError code', async () => {
	const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

	const { audioEl } = await renderPlayer()

	Object.defineProperty(audioEl, 'error', {
		configurable: true,
		value: { code: 99, message: 'Unknown error' },
	})

	audioEl.dispatchEvent(new Event('error'))

	await waitFor(() => {
		expect(screen.getByTestId('player-playback-error')).toHaveTextContent(
			'An unexpected playback error occurred. Please try again.',
		)
	})

	consoleSpy.mockRestore()
})

test('does not show playback error when audio error is null (no MediaError)', async () => {
	const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

	const { audioEl } = await renderPlayer()

	// No error property set — error event without MediaError should not show anything
	audioEl.dispatchEvent(new Event('error'))

	expect(consoleSpy).not.toHaveBeenCalled()

	await waitFor(() => {
		expect(
			screen.queryByTestId('player-playback-error'),
		).not.toBeInTheDocument()
	})

	consoleSpy.mockRestore()
})

test('calls onNext when audio ends and loopMode is off', async () => {
	const onNext = vi.fn()

	const { audioEl } = await renderPlayer({ onNext, loopMode: 'off' })

	audioEl.dispatchEvent(new Event('ended'))

	expect(onNext).toHaveBeenCalledOnce()
})

test('does NOT call onNext when audio ends and loopMode is one', async () => {
	const onNext = vi.fn()

	const { audioEl } = await renderPlayer({ onNext, loopMode: 'one' })

	audioEl.dispatchEvent(new Event('ended'))

	expect(onNext).not.toHaveBeenCalled()
})

test('persists volume changes to localStorage', async () => {
	await renderPlayer()

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

test('calls onNext when next button is clicked', async () => {
	const onNext = vi.fn()

	await renderPlayer({ onNext, hasNext: true })

	const nextButton = document.querySelector('[aria-label="Next track"]')
	expect(nextButton).not.toBeNull()

	nextButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))

	expect(onNext).toHaveBeenCalledOnce()
})

test('calls onPrevious when previous button is clicked', async () => {
	const onPrevious = vi.fn()

	await renderPlayer({ onPrevious, hasPrevious: true })

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

afterEach(() => {
	vi.restoreAllMocks()
	mockRemoveTrackFromPlaylist.mockReset()
	window.localStorage.clear()
})

beforeEach(() => {
	vi.mocked(useAudioPlayer).mockReturnValue(
		createAudioPlayerMock() as unknown as ReturnType<typeof useAudioPlayer>,
	)
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

	await waitFor(() => {
		expect(playSpy).toHaveBeenCalled()
		expect(wantsAutoPlayRef.current).toBe(false)
	})
})

test('keeps player chrome visible while the next track audio URL is loading', async () => {
	const { resolveTrackPlaybackSource } = await import(
		'#app/features/offline-storage/resolve-playback-url.client.ts'
	)
	const resolveMock = vi.mocked(resolveTrackPlaybackSource)
	let resolveSecondTrack: ((url: string) => void) | undefined

	resolveMock.mockImplementation((trackId: string) => {
		if (trackId === 'track-2') {
			return new Promise(resolve => {
				resolveSecondTrack = resolve
			})
		}
		return Promise.resolve('https://cdn.example/track-1.mp3')
	})

	const { rerender } = await renderPlayer()

	rerender(
		<AudioPlayer
			{...defaultProps}
			track={mockTrack2}
			playbackToken={2}
			wantsAutoPlayRef={{ current: true }}
		/>,
	)

	expect(screen.getByTestId('player-desktop-bar')).toBeTruthy()

	resolveSecondTrack?.('https://cdn.example/track-2.mp3')

	await waitFor(() => {
		expect(screen.getByTestId('player-desktop-bar')).toBeTruthy()
	})
})

test('renders mobile mini bar with play and close controls', async () => {
	await renderPlayer()

	const miniBar = screen.getByTestId('player-mini-bar')
	expect(within(miniBar).getByLabelText('Play')).toBeTruthy()
	expect(within(miniBar).getByLabelText('Close player')).toBeTruthy()
	expect(within(miniBar).getByLabelText('Open queue')).toBeTruthy()
})

test('shows controls in the now playing sheet', async () => {
	const user = userEvent.setup()
	await renderPlayer()

	await user.click(screen.getByLabelText('Open now playing'))

	const sheet = await screen.findByTestId('player-now-playing-sheet')
	expect(within(sheet).getByLabelText('Shuffle: off')).toBeTruthy()
	expect(within(sheet).getByLabelText('Loop: off')).toBeTruthy()
	expect(within(sheet).getByLabelText('Add to playlist')).toBeTruthy()
	expect(within(sheet).getByLabelText('Sleep timer')).toBeTruthy()
	expect(within(sheet).getByLabelText('More actions')).toBeTruthy()
})

test('overflow sheet opens with all action buttons', async () => {
	const user = userEvent.setup()
	await renderPlayer()

	await user.click(screen.getByLabelText('Open now playing'))
	const sheet = await screen.findByTestId('player-now-playing-sheet')

	await user.click(within(sheet).getByLabelText('More actions'))

	// Verify all overflow actions are present
	expect(screen.getByText('Download')).toBeTruthy()
	expect(screen.getByText('Play Next')).toBeTruthy()
	expect(screen.getByText('Add to Up Next')).toBeTruthy()
	expect(screen.getByText('Add to Queue')).toBeTruthy()
	expect(screen.getByText('Track Details')).toBeTruthy()
})

test('overflow sheet Play Next calls playNextTrack with toast', async () => {
	const { playNextTrack } = useAudioPlayer()
	const user = userEvent.setup()
	await renderPlayer()

	await user.click(screen.getByLabelText('Open now playing'))
	const sheet = await screen.findByTestId('player-now-playing-sheet')

	await user.click(within(sheet).getByLabelText('More actions'))
	await user.click(screen.getByText('Play Next'))

	expect(playNextTrack).toHaveBeenCalled()
})

test('overflow sheet Add to Queue calls addToQueue with toast', async () => {
	const { addToQueue } = useAudioPlayer()
	const user = userEvent.setup()
	await renderPlayer()

	await user.click(screen.getByLabelText('Open now playing'))
	const sheet = await screen.findByTestId('player-now-playing-sheet')

	await user.click(within(sheet).getByLabelText('More actions'))
	await user.click(screen.getByText('Add to Queue'))

	expect(addToQueue).toHaveBeenCalled()
})

test('renders desktop bar with volume and transport controls', async () => {
	await renderPlayer()

	const desktopBar = screen.getByTestId('player-desktop-bar')
	expect(within(desktopBar).getByLabelText('Volume')).toBeTruthy()
	expect(within(desktopBar).getByLabelText('Next track')).toBeTruthy()
	expect(within(desktopBar).getByLabelText('Shuffle: off')).toBeTruthy()
})
