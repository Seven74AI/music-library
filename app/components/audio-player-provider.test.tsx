/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { type FullTrack } from '#app/types/frontend/shared'
import { AudioPlayerProvider, useAudioPlayer } from './audio-player-provider'

vi.mock('./audio-player', () => ({
	AudioPlayer: () => null,
}))

const mockTrack: FullTrack = {
	id: 'track-1',
	title: 'Test Song',
	artist: { id: 'artist-1', name: 'Test Artist' },
	duration: 180,
	coverImage: { objectKey: 'covers/test.jpg' },
	audioFiles: [{ id: 'af-1', format: 'mp3', objectKey: 'audio/test.mp3' }],
}

function QueueProbe() {
	const { playNextTrack, playlist } = useAudioPlayer()

	return (
		<>
			<button type="button" onClick={() => playNextTrack(mockTrack)}>
				Play next track
			</button>
			<span data-testid="playlist-length">{playlist.length}</span>
			<span data-testid="playlist-ids">{playlist.map((track) => track.id).join(',')}</span>
			<span data-testid="has-holes">{String(playlist.some((_, index) => !(index in playlist)))}</span>
		</>
	)
}

test('playNextTrack on empty playlist adds a single track without sparse holes', async () => {
	const user = userEvent.setup()

	render(
		<AudioPlayerProvider>
			<QueueProbe />
		</AudioPlayerProvider>,
	)

	await user.click(screen.getByRole('button', { name: 'Play next track' }))

	expect(screen.getByTestId('playlist-length').textContent).toBe('1')
	expect(screen.getByTestId('playlist-ids').textContent).toBe('track-1')
	expect(screen.getByTestId('has-holes').textContent).toBe('false')
})
