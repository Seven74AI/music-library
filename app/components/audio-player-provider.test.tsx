/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi, beforeEach, afterEach } from 'vitest'
import { type FullTrack } from '#app/types/frontend/shared'
import { AudioPlayerProvider, useAudioPlayer } from './audio-player-provider'

vi.mock('./audio-player', () => ({
	AudioPlayer: () => null,
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
	const { playNextTrack, addToCurrentPlaylist, playlist } = useAudioPlayer()

	return (
		<>
			<button type="button" onClick={() => playNextTrack(playableTrack)}>
				Play next track
			</button>
			<button type="button" onClick={() => addToCurrentPlaylist(metadataTrack)}>
				Add metadata track
			</button>
			<span data-testid="playlist-length">{playlist.length}</span>
			<span data-testid="playlist-ids">{playlist.map((track) => track.id).join(',')}</span>
			<span data-testid="has-holes">{String(playlist.some((_, index) => !(index in playlist)))}</span>
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

test('addToCurrentPlaylist ignores metadata-only tracks', async () => {
	const user = userEvent.setup()

	render(
		<AudioPlayerProvider>
			<QueueProbe />
		</AudioPlayerProvider>,
	)

	await user.click(screen.getByRole('button', { name: 'Add metadata track' }))

	expect(screen.getByTestId('playlist-length').textContent).toBe('0')
	expect(screen.getByTestId('playlist-ids').textContent).toBe('')
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
