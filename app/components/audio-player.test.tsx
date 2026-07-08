/**
 * @vitest-environment jsdom
 */
import { type ReactNode } from 'react'
import { render } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { AudioPlayer } from './audio-player'

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

const mockTrack = {
	id: 'track-1',
	title: 'Test Song',
	artist: { id: 'artist-1', name: 'Test Artist' },
	duration: 180,
	coverImage: null,
	thumbnailUrl: null,
	serviceUrl: 'https://youtube.com/watch?v=test',
	service: { displayName: 'YouTube', logoUrl: null },
	audioFiles: [{ format: 'mp3', url: 'https://example.com/test.mp3' }],
	isInUserLibrary: false,
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
