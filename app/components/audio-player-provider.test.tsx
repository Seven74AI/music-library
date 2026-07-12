/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi, beforeEach, afterEach } from 'vitest'
import { type FullTrack } from '#app/types/frontend/shared'
import { AudioPlayerProvider, useAudioPlayer } from './audio-player-provider'

vi.mock('./audio-player', () => ({
	AudioPlayer: ({
		wantsAutoPlayRef,
	}: {
		wantsAutoPlayRef?: React.MutableRefObject<boolean>
	}) => (
		<span data-testid="wants-autoplay">{String(wantsAutoPlayRef?.current ?? false)}</span>
	),
}))

vi.mock('#app/components/pwa/install-app-banner', () => ({
	InstallAppBanner: () => null,
}))

vi.mock('#app/features/offline-storage/offline-storage.client.ts', () => ({
	getOfflineStorage: () => ({
		cacheQueueTrack: vi.fn().mockResolvedValue(undefined),
		listDownloaded: vi.fn().mockResolvedValue([
			{
				trackId: 'track-1',
				title: 'Test Song',
				artistId: 'artist-1',
				artistName: 'Test Artist',
				duration: 180,
				coverObjectKey: 'covers/test.jpg',
				audioFormat: 'mp3',
				isPinned: true,
				isQueueCached: false,
				fileSizeBytes: 1000,
				lastAccessedAt: Date.now(),
			},
		]),
		listPinned: vi.fn().mockResolvedValue([
			{
				trackId: 'track-1',
				title: 'Test Song',
				artistId: 'artist-1',
				artistName: 'Test Artist',
				duration: 180,
				coverObjectKey: 'covers/test.jpg',
				audioFormat: 'mp3',
				isPinned: true,
				isQueueCached: false,
				fileSizeBytes: 1000,
				lastAccessedAt: Date.now(),
			},
		]),
		listForPlaylist: vi.fn().mockResolvedValue([]),
	}),
}))

const playableTrack: FullTrack = {
	id: 'track-1',
	title: 'Test Song',
	artist: { id: 'artist-1', name: 'Test Artist' },
	duration: 180,
	coverImage: { objectKey: 'covers/test.jpg' },
	audioFiles: [{ id: 'af-1', format: 'mp3', objectKey: 'audio/test.mp3' }],
}

const secondPlayableTrack: FullTrack = {
	...playableTrack,
	id: 'track-2',
	title: 'Second Song',
}

const thirdPlayableTrack: FullTrack = {
	...playableTrack,
	id: 'track-3',
	title: 'Third Song',
}

const metadataTrack: FullTrack = {
	...playableTrack,
	id: 'track-2',
	title: 'Metadata Only',
	audioFiles: [],
}

const spineTrack = {
	id: 'track-1',
	title: 'Test Song',
	artist: { id: 'artist-1', name: 'Test Artist' },
}

function QueueProbe() {
	const {
		playNextTrack,
		addToUpNext,
		addToQueue,
		addToCurrentPlaylist,
		playTrack,
		startQueuePlayback,
		playlist,
		upNext,
		spine,
		currentTrack,
		isPlayerVisible,
		hasQueuedPlayback,
	} = useAudioPlayer()

	return (
		<>
			<button type="button" onClick={() => playNextTrack(playableTrack)}>
				Play next track
			</button>
			<button type="button" onClick={() => playNextTrack(secondPlayableTrack)}>
				Play second next
			</button>
			<button type="button" onClick={() => playNextTrack(thirdPlayableTrack)}>
				Play third next
			</button>
			<button type="button" onClick={() => addToUpNext(playableTrack)}>
				Add to up next
			</button>
			<button type="button" onClick={() => addToQueue(playableTrack)}>
				Add to queue
			</button>
			<button type="button" onClick={() => void startQueuePlayback()}>
				Start queue playback
			</button>
			<button type="button" onClick={() => addToCurrentPlaylist(metadataTrack)}>
				Add metadata track
			</button>
			<button
				type="button"
				onClick={() => playTrack(playableTrack, { type: 'library' }, 0)}
			>
				Play library track
			</button>
			<span data-testid="current-track-id">{currentTrack?.id ?? ''}</span>
			<span data-testid="player-visible">{String(isPlayerVisible)}</span>
			<span data-testid="has-queued-playback">{String(hasQueuedPlayback)}</span>
			<span data-testid="up-next-ids">{upNext.map(track => track.id).join(',')}</span>
			<span data-testid="spine-ids">{spine.map(track => track.id).join(',')}</span>
			<span data-testid="playlist-ids">{playlist.map(track => track.id).join(',')}</span>
		</>
	)
}

function PlayTrackProbe() {
	const { playTrack, playlist } = useAudioPlayer()

	return (
		<>
			<button
				type="button"
				onClick={() => playTrack(playableTrack, { type: 'library' }, 0)}
			>
				Play library track
			</button>
			<span data-testid="playlist-length">{playlist.length}</span>
		</>
	)
}

function PlayLibraryProbe() {
	const { playLibrary } = useAudioPlayer()

	return (
		<button type="button" onClick={() => void playLibrary()}>
			Play library
		</button>
	)
}

function PlayUserPlaylistProbe() {
	const { playUserPlaylist } = useAudioPlayer()

	return (
		<button type="button" onClick={() => void playUserPlaylist('playlist-1')}>
			Play user playlist
		</button>
	)
}

beforeEach(() => {
	vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

test('playNextTrack on cold start cues track as current without autoplay', async () => {
	const user = userEvent.setup()

	render(
		<AudioPlayerProvider>
			<QueueProbe />
		</AudioPlayerProvider>,
	)

	await user.click(screen.getByRole('button', { name: 'Play next track' }))

	expect(screen.getByTestId('current-track-id').textContent).toBe('track-1')
	expect(screen.getByTestId('player-visible').textContent).toBe('true')
	expect(screen.getByTestId('up-next-ids').textContent).toBe('')
	expect(screen.getByTestId('wants-autoplay').textContent).toBe('false')
})

test('playNextTrack stacks FIFO at the front of Up Next when playback is active', async () => {
	const user = userEvent.setup()
	const fetchMock = vi.mocked(fetch)

	fetchMock
		.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				tracks: [spineTrack, { ...spineTrack, id: 'track-2', title: 'Other' }],
				total: 2,
			}),
		} as Response)
		.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ tracks: [playableTrack] }),
		} as Response)

	render(
		<AudioPlayerProvider>
			<QueueProbe />
		</AudioPlayerProvider>,
	)

	await user.click(screen.getByRole('button', { name: 'Play library track' }))
	await waitFor(() => {
		expect(screen.getByTestId('current-track-id').textContent).toBe('track-1')
	})

	await user.click(screen.getByRole('button', { name: 'Play second next' }))
	await user.click(screen.getByRole('button', { name: 'Play third next' }))

	expect(screen.getByTestId('up-next-ids').textContent).toBe('track-2,track-3')
})

test('addToUpNext exposes queued playback while idle', async () => {
	const user = userEvent.setup()

	render(
		<AudioPlayerProvider>
			<QueueProbe />
		</AudioPlayerProvider>,
	)

	await user.click(screen.getByRole('button', { name: 'Add to up next' }))

	expect(screen.getByTestId('up-next-ids').textContent).toBe('track-1')
	expect(screen.getByTestId('current-track-id').textContent).toBe('')
	expect(screen.getByTestId('player-visible').textContent).toBe('true')
	expect(screen.getByTestId('has-queued-playback').textContent).toBe('true')
})

test('startQueuePlayback plays the first Up Next track when idle', async () => {
	const user = userEvent.setup()

	render(
		<AudioPlayerProvider>
			<QueueProbe />
		</AudioPlayerProvider>,
	)

	await user.click(screen.getByRole('button', { name: 'Add to up next' }))
	await user.click(screen.getByRole('button', { name: 'Start queue playback' }))

	expect(screen.getByTestId('current-track-id').textContent).toBe('track-1')
	expect(screen.getByTestId('up-next-ids').textContent).toBe('')
})

test('addToUpNext appends to the Up Next tail and opens the player when idle', async () => {
	const user = userEvent.setup()

	render(
		<AudioPlayerProvider>
			<QueueProbe />
		</AudioPlayerProvider>,
	)

	await user.click(screen.getByRole('button', { name: 'Add to up next' }))

	expect(screen.getByTestId('up-next-ids').textContent).toBe('track-1')
	expect(screen.getByTestId('current-track-id').textContent).toBe('')
	expect(screen.getByTestId('player-visible').textContent).toBe('true')
	expect(screen.getByTestId('wants-autoplay').textContent).toBe('false')
})

test('addToQueue appends after the spine and opens the player when idle', async () => {
	const user = userEvent.setup()

	render(
		<AudioPlayerProvider>
			<QueueProbe />
		</AudioPlayerProvider>,
	)

	await user.click(screen.getByRole('button', { name: 'Add to queue' }))

	expect(screen.getByTestId('playlist-ids').textContent).toBe('track-1')
	expect(screen.getByTestId('spine-ids').textContent).toBe('track-1')
	expect(screen.getByTestId('up-next-ids').textContent).toBe('')
	expect(screen.getByTestId('current-track-id').textContent).toBe('')
	expect(screen.getByTestId('player-visible').textContent).toBe('true')
})

test('playNextTrack inserts before existing add-to-up-next items', async () => {
	const user = userEvent.setup()
	const fetchMock = vi.mocked(fetch)

	fetchMock
		.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				tracks: [spineTrack, { ...spineTrack, id: 'track-2', title: 'Other' }],
				total: 2,
			}),
		} as Response)
		.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ tracks: [playableTrack] }),
		} as Response)

	render(
		<AudioPlayerProvider>
			<QueueProbe />
		</AudioPlayerProvider>,
	)

	await user.click(screen.getByRole('button', { name: 'Play library track' }))
	await waitFor(() => {
		expect(screen.getByTestId('current-track-id').textContent).toBe('track-1')
	})

	fetchMock.mockResolvedValue({
		ok: true,
		json: async () => ({ tracks: [playableTrack, secondPlayableTrack] }),
	} as Response)

	await user.click(screen.getByRole('button', { name: 'Add to up next' }))
	await user.click(screen.getByRole('button', { name: 'Play second next' }))

	expect(screen.getByTestId('up-next-ids').textContent).toBe('track-2,track-1')
})

test('addToCurrentPlaylist maps to addToUpNext', async () => {
	const user = userEvent.setup()

	render(
		<AudioPlayerProvider>
			<QueueProbe />
		</AudioPlayerProvider>,
	)

	await user.click(screen.getByRole('button', { name: 'Add to up next' }))
	await user.click(screen.getByRole('button', { name: 'Add metadata track' }))

	expect(screen.getByTestId('up-next-ids').textContent).toBe('track-1')
})

test('playTrack loads queue spine and hydrates playback for the clicked track', async () => {
	const user = userEvent.setup()
	const fetchMock = vi.mocked(fetch)

	fetchMock
		.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				tracks: [spineTrack, { ...spineTrack, id: 'track-2', title: 'Other' }],
				total: 2,
			}),
		} as Response)
		.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ tracks: [playableTrack] }),
		} as Response)

	render(
		<AudioPlayerProvider>
			<PlayTrackProbe />
		</AudioPlayerProvider>,
	)

	await user.click(screen.getByRole('button', { name: 'Play library track' }))

	await waitFor(() => {
		expect(fetchMock).toHaveBeenCalled()
	})

	const spineRequestUrl = String(fetchMock.mock.calls[0]?.[0])
	expect(spineRequestUrl).toContain('/api/queue-spine')
	expect(spineRequestUrl).toContain('context=library')
	expect(spineRequestUrl).toContain('hasAudio=1')

	const hydrationRequestUrl = String(fetchMock.mock.calls[1]?.[0])
	expect(hydrationRequestUrl).toContain('/api/tracks/playback')
})

test('playLibrary requests queue spine and hydrates the first track', async () => {
	const user = userEvent.setup()
	const fetchMock = vi.mocked(fetch)

	fetchMock
		.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				tracks: [spineTrack],
				total: 1,
			}),
		} as Response)
		.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ tracks: [playableTrack] }),
		} as Response)

	render(
		<AudioPlayerProvider>
			<PlayLibraryProbe />
		</AudioPlayerProvider>,
	)

	await user.click(screen.getByRole('button', { name: 'Play library' }))

	await waitFor(() => {
		expect(fetchMock).toHaveBeenCalled()
	})

	const spineRequestUrl = String(fetchMock.mock.calls[0]?.[0])
	expect(spineRequestUrl).toContain('/api/queue-spine')
	expect(spineRequestUrl).toContain('hasAudio=1')
})

test('playUserPlaylist requests playlist queue spine and hydrates playback', async () => {
	const user = userEvent.setup()
	const fetchMock = vi.mocked(fetch)

	fetchMock
		.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				tracks: [spineTrack],
				total: 1,
			}),
		} as Response)
		.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ tracks: [playableTrack] }),
		} as Response)

	render(
		<AudioPlayerProvider>
			<PlayUserPlaylistProbe />
		</AudioPlayerProvider>,
	)

	await user.click(screen.getByRole('button', { name: 'Play user playlist' }))

	await waitFor(() => {
		expect(fetchMock).toHaveBeenCalled()
	})

	const spineRequestUrl = String(fetchMock.mock.calls[0]?.[0])
	expect(spineRequestUrl).toContain('/api/queue-spine')
	expect(spineRequestUrl).toContain('context=playlist')
	expect(spineRequestUrl).toContain('playlistId=playlist-1')
})

test('playTrack falls back to offline downloads when online spine fetch fails', async () => {
	const user = userEvent.setup()
	const fetchMock = vi.mocked(fetch)
	const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
	vi.stubGlobal('navigator', { onLine: false })

	fetchMock.mockResolvedValueOnce({
		ok: false,
		status: 503,
		statusText: 'Service Unavailable',
	} as Response)

	render(
		<AudioPlayerProvider>
			<PlayTrackProbe />
		</AudioPlayerProvider>,
	)

	await user.click(screen.getByRole('button', { name: 'Play library track' }))

	await waitFor(() => {
		expect(fetchMock).toHaveBeenCalled()
		expect(screen.getByTestId('playlist-length').textContent).toBe('1')
	})

	consoleError.mockRestore()
	vi.unstubAllGlobals()
})
