/**
 * @vitest-environment jsdom
 *
 * Integration tests for queue actions: real AudioPlayerProvider + AudioPlayer,
 * only network/storage mocked. Catches bugs that unit tests with mocked hooks miss.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ComponentProps, StrictMode, type ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { type FullTrack } from '#app/types/frontend/shared'
import { AudioPlayerProvider, useAudioPlayer } from './audio-player-provider'
import { TrackListItem } from './track-list-item'

vi.mock('#app/components/pwa/install-app-banner', () => ({
	InstallAppBanner: () => null,
}))

vi.mock('#app/components/ui/use-toast.ts', () => ({
	toast: vi.fn(),
}))

vi.mock('#app/features/offline-storage/resolve-playback-url.client.ts', () => ({
	resolveTrackPlaybackSource: vi.fn().mockResolvedValue('https://cdn.example/track.mp3'),
	revokePlaybackAudioUrl: vi.fn(),
}))

vi.mock('#app/features/offline-storage/offline-storage.client.ts', () => ({
	getOfflineStorage: () => ({
		cacheQueueTrack: vi.fn().mockResolvedValue(undefined),
		listDownloaded: vi.fn().mockResolvedValue([]),
		listPinned: vi.fn().mockResolvedValue([]),
		listForPlaylist: vi.fn().mockResolvedValue([]),
	}),
}))

const trackA: FullTrack = {
	id: 'track-a',
	title: 'Alpha Song',
	artist: { id: 'artist-1', name: 'Artist One' },
	duration: 180,
	coverImage: { objectKey: 'covers/a.jpg' },
	audioFiles: [{ id: 'af-a', format: 'mp3', objectKey: 'audio/a.mp3' }],
}

const trackB: FullTrack = {
	...trackA,
	id: 'track-b',
	title: 'Bravo Song',
	audioFiles: [{ id: 'af-b', format: 'mp3', objectKey: 'audio/b.mp3' }],
}

const trackC: FullTrack = {
	...trackA,
	id: 'track-c',
	title: 'Charlie Song',
	audioFiles: [{ id: 'af-c', format: 'mp3', objectKey: 'audio/c.mp3' }],
}

const spineTracks = [
	{ id: 'track-a', title: 'Alpha Song', artist: trackA.artist },
	{ id: 'track-b', title: 'Bravo Song', artist: trackB.artist },
	{ id: 'track-c', title: 'Charlie Song', artist: trackC.artist },
]

function mockSpineAndHydration(fetchMock: ReturnType<typeof vi.fn>) {
	fetchMock.mockImplementation((input: RequestInfo | URL) => {
		const url = String(input)
		if (url.includes('/api/queue-spine')) {
			return Promise.resolve({
				ok: true,
				json: async () => ({ tracks: spineTracks, total: spineTracks.length }),
			} as Response)
		}
		if (url.includes('/api/tracks/playback')) {
			const ids = new URL(url, 'http://test').searchParams.get('ids')?.split(',') ?? []
			const tracks = [trackA, trackB, trackC].filter(track => ids.includes(track.id))
			return Promise.resolve({
				ok: true,
				json: async () => ({ tracks }),
			} as Response)
		}
		return Promise.reject(new Error(`Unexpected fetch: ${url}`))
	})
}

function QueueControls({
	actions,
}: {
	actions: Array<{ label: string; onClick: () => void }>
}) {
	return (
		<>
			{actions.map(action => (
				<button key={action.label} type="button" onClick={action.onClick}>
					{action.label}
				</button>
			))}
		</>
	)
}

function WarmPlaybackControls() {
	const { playTrack, playNextTrack, addToUpNext, addToQueue } = useAudioPlayer()

	return (
		<QueueControls
			actions={[
				{
					label: 'Start library playback',
					onClick: () => playTrack(trackA, { type: 'library' }, 0),
				},
				{ label: 'Play next Bravo', onClick: () => playNextTrack(trackB) },
				{ label: 'Play next Charlie', onClick: () => playNextTrack(trackC) },
				{ label: 'Add Bravo to up next', onClick: () => addToUpNext(trackB) },
				{ label: 'Add Charlie to queue', onClick: () => addToQueue(trackC) },
			]}
		/>
	)
}

function IdleQueueControls() {
	const { addToUpNext, addToQueue, playNextTrack } = useAudioPlayer()

	return (
		<QueueControls
			actions={[
				{ label: 'Add Bravo to up next', onClick: () => addToUpNext(trackB) },
				{ label: 'Add Charlie to queue', onClick: () => addToQueue(trackC) },
				{ label: 'Play next Charlie', onClick: () => playNextTrack(trackC) },
			]}
		/>
	)
}

function libraryTrackListItem(
	track: FullTrack,
	index: number,
): ComponentProps<typeof TrackListItem>['track'] {
	return {
		id: track.id,
		title: track.title,
		artist: track.artist,
		duration: track.duration,
		coverImage: track.coverImage,
		thumbnailUrl: null,
		serviceUrl: null,
		service: null,
		audioFiles: track.audioFiles,
	}
}

function LibraryRowPlayNext() {
	return (
		<TrackListItem
			track={libraryTrackListItem(trackC, 2)}
			userTrack={{ createdAt: new Date().toISOString() }}
			index={2}
			playlistContext={{ type: 'library' }}
		/>
	)
}

function LibraryRowPlayAlpha() {
	return (
		<TrackListItem
			track={libraryTrackListItem(trackA, 0)}
			userTrack={{ createdAt: new Date().toISOString() }}
			index={0}
			playlistContext={{ type: 'library' }}
		/>
	)
}

function buildPlayableTracks(count: number, titlePrefix: string): FullTrack[] {
	return Array.from({ length: count }, (_, index) => ({
		...trackA,
		id: `bulk-${titlePrefix.toLowerCase()}-${index}`,
		title: `${titlePrefix} ${index + 1}`,
		audioFiles: [
			{
				id: `af-${titlePrefix.toLowerCase()}-${index}`,
				format: 'mp3' as const,
				objectKey: `audio/${titlePrefix.toLowerCase()}-${index}.mp3`,
			},
		],
	}))
}

function renderQueueApp(children: ReactNode) {
	return render(<AudioPlayerProvider>{children}</AudioPlayerProvider>)
}

async function openQueueSheet(user: ReturnType<typeof userEvent.setup>) {
	const queueButtons = screen.getAllByLabelText('Open queue')
	await user.click(queueButtons[0]!)
	return await screen.findByRole('dialog')
}

function upNextTitlesInSheet(sheet: HTMLElement): string[] {
	const upNextHeading = within(sheet).getByText('Up Next')
	const section = upNextHeading.closest('section')
	if (!section) return []
	return within(section)
		.getAllByRole('button', { name: /Remove .+ from queue/ })
		.map(button => button.getAttribute('aria-label')?.replace(/^Remove /, '').replace(/ from queue$/, '') ?? '')
}

async function startWarmLibraryPlayback(user: ReturnType<typeof userEvent.setup>) {
	await user.click(screen.getByRole('button', { name: 'Start library playback' }))
	await waitFor(() => {
		expect(screen.getByTestId('player-desktop-bar')).toBeTruthy()
	})
	await waitFor(() => {
		expect(
			within(screen.getByTestId('player-desktop-bar')).getByText('Alpha Song'),
		).toBeTruthy()
	})
}

function spineTitlesInSheet(sheet: HTMLElement): string[] {
	const spineHeading =
		within(sheet).queryByText('From Library') ??
		within(sheet).queryByText('From Queue') ??
		within(sheet).queryByText('From Playlist')
	if (!spineHeading) return []
	const section = spineHeading.closest('section')
	if (!section) return []
	return within(section)
		.getAllByRole('button', { name: /Remove .+ from queue/ })
		.map(button => button.getAttribute('aria-label')?.replace(/^Remove /, '').replace(/ from queue$/, '') ?? '')
}

function queueTrackRemoveButtonsInSheet(sheet: HTMLElement) {
	return within(sheet).getAllByRole('button', { name: /Remove .+ from queue/ })
}

function removeTrackInSection(section: HTMLElement, title: string) {
	return within(section).getByRole('button', { name: `Remove ${title} from queue` })
}

function nowPlayingTitleInSheet(sheet: HTMLElement): string | null {
	const heading = within(sheet).queryByText('Now playing')
	if (!heading) return null
	const section = heading.closest('section')
	if (!section) return null
	const removeButton = within(section).getByRole('button', { name: /Remove .+ from queue/ })
	return (
		removeButton.getAttribute('aria-label')?.replace(/^Remove /, '').replace(/ from queue$/, '') ??
		null
	)
}

async function clickNextTrack(user: ReturnType<typeof userEvent.setup>) {
	const desktopBar = screen.getByTestId('player-desktop-bar')
	await user.click(within(desktopBar).getByLabelText('Next track'))
}

function buildLargeSpineTracks(count: number) {
	return Array.from({ length: count }, (_, index) => ({
		id: `track-${index}`,
		title: `Library Track ${index + 1}`,
		artist: { id: 'artist-1', name: 'Artist One' },
	}))
}

function mockLargeLibrarySpine(fetchMock: ReturnType<typeof vi.fn>, spineCount: number) {
	const largeSpine = buildLargeSpineTracks(spineCount)
	fetchMock.mockImplementation((input: RequestInfo | URL) => {
		const url = String(input)
		if (url.includes('/api/queue-spine')) {
			return Promise.resolve({
				ok: true,
				json: async () => ({ tracks: largeSpine, total: largeSpine.length }),
			} as Response)
		}
		if (url.includes('/api/tracks/playback')) {
			const ids = new URL(url, 'http://test').searchParams.get('ids')?.split(',') ?? []
			const tracks = ids.map(id => {
				const index = Number.parseInt(id.replace('track-', ''), 10)
				return {
					...trackA,
					id,
					title: `Library Track ${index + 1}`,
				}
			})
			return Promise.resolve({
				ok: true,
				json: async () => ({ tracks }),
			} as Response)
		}
		return Promise.reject(new Error(`Unexpected fetch: ${url}`))
	})
	return largeSpine
}

beforeAll(() => {
	Object.defineProperty(window, 'matchMedia', {
		writable: true,
		value: (query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => false,
		}),
	})

	vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(function (
		this: HTMLMediaElement,
	) {
		Object.defineProperty(this, 'paused', { configurable: true, value: false })
		return Promise.resolve()
	})
})

beforeEach(() => {
	vi.stubGlobal('fetch', vi.fn())
	window.localStorage.clear()
})

afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe('queue sheet integration', () => {
	test('shows upcoming spine tracks while library playback is active', async () => {
		const user = userEvent.setup()
		mockSpineAndHydration(vi.mocked(fetch))

		renderQueueApp(<WarmPlaybackControls />)
		await startWarmLibraryPlayback(user)

		const sheet = await openQueueSheet(user)

		expect(within(sheet).queryByText('Queue is Empty')).toBeNull()
		expect(queueTrackRemoveButtonsInSheet(sheet).length).toBeGreaterThanOrEqual(3)
		expect(within(sheet).getByText('Now playing')).toBeTruthy()
		expect(within(sheet).getByText('Alpha Song')).toBeTruthy()
		expect(spineTitlesInSheet(sheet)).toEqual(['Bravo Song', 'Charlie Song'])
	})

	test('shows spine tracks when library has more than the virtual list threshold', async () => {
		const user = userEvent.setup()
		const largeSpine = mockLargeLibrarySpine(vi.mocked(fetch), 25)

		function LargeLibraryPlayback() {
			const { playTrack } = useAudioPlayer()
			return (
				<button
					type="button"
					onClick={() =>
						playTrack(
							{
								...trackA,
								id: largeSpine[0]!.id,
								title: largeSpine[0]!.title,
							},
							{ type: 'library' },
							0,
						)
					}
				>
					Start large library playback
				</button>
			)
		}

		renderQueueApp(<LargeLibraryPlayback />)
		await user.click(screen.getByRole('button', { name: 'Start large library playback' }))
		await waitFor(() => {
			expect(within(screen.getByTestId('player-desktop-bar')).getByText('Library Track 1')).toBeTruthy()
		})

		const sheet = await openQueueSheet(user)

		expect(within(sheet).queryByText('Queue is Empty')).toBeNull()
		expect(within(sheet).getByText('Now playing')).toBeTruthy()
		expect(within(sheet).getByText('Library Track 1')).toBeTruthy()
		expect(within(sheet).getByText('From Library')).toBeTruthy()
		expect(queueTrackRemoveButtonsInSheet(sheet).length).toBeGreaterThan(20)
		expect(spineTitlesInSheet(sheet).slice(0, 3)).toEqual([
			'Library Track 2',
			'Library Track 3',
			'Library Track 4',
		])
	})

	test('hydrates cover art for queue tracks beyond playback lookahead', async () => {
		const user = userEvent.setup()
		const spineCount = 8
		const largeSpine = buildLargeSpineTracks(spineCount)
		const fetchMock = vi.mocked(fetch)
		fetchMock.mockImplementation((input: RequestInfo | URL) => {
			const url = String(input)
			if (url.includes('/api/queue-spine')) {
				return Promise.resolve({
					ok: true,
					json: async () => ({ tracks: largeSpine, total: largeSpine.length }),
				} as Response)
			}
			if (url.includes('/api/tracks/playback')) {
				const ids = new URL(url, 'http://test').searchParams.get('ids')?.split(',') ?? []
				const tracks = ids.map(id => {
					const index = Number.parseInt(id.replace('track-', ''), 10)
					return {
						...trackA,
						id,
						title: `Library Track ${index + 1}`,
						coverImage: { objectKey: `covers/${id}.jpg` },
					}
				})
				return Promise.resolve({
					ok: true,
					json: async () => ({ tracks }),
				} as Response)
			}
			return Promise.reject(new Error(`Unexpected fetch: ${url}`))
		})

		function LargeLibraryPlayback() {
			const { playTrack } = useAudioPlayer()
			return (
				<button
					type="button"
					onClick={() =>
						playTrack(
							{
								...trackA,
								id: largeSpine[0]!.id,
								title: largeSpine[0]!.title,
								coverImage: { objectKey: 'covers/track-0.jpg' },
							},
							{ type: 'library' },
							0,
						)
					}
				>
					Start library playback
				</button>
			)
		}

		renderQueueApp(<LargeLibraryPlayback />)
		await user.click(screen.getByRole('button', { name: 'Start library playback' }))
		await waitFor(() => {
			expect(within(screen.getByTestId('player-desktop-bar')).getByText('Library Track 1')).toBeTruthy()
		})

		const sheet = await openQueueSheet(user)

		await waitFor(() => {
			expect(within(sheet).getAllByRole('img').length).toBeGreaterThanOrEqual(6)
		})
	})

	test('add to up next shows track in Up Next while playing', async () => {
		const user = userEvent.setup()
		mockSpineAndHydration(vi.mocked(fetch))

		renderQueueApp(<WarmPlaybackControls />)
		await startWarmLibraryPlayback(user)
		await user.click(screen.getByRole('button', { name: 'Add Bravo to up next' }))

		const sheet = await openQueueSheet(user)

		expect(upNextTitlesInSheet(sheet)).toEqual(['Bravo Song'])
		expect(spineTitlesInSheet(sheet)).toEqual(['Bravo Song', 'Charlie Song'])
	})

	test('play next inserts at the front of Up Next, before add-to-up-next tail', async () => {
		const user = userEvent.setup()
		mockSpineAndHydration(vi.mocked(fetch))

		renderQueueApp(<WarmPlaybackControls />)
		await startWarmLibraryPlayback(user)
		await user.click(screen.getByRole('button', { name: 'Add Bravo to up next' }))
		await user.click(screen.getByRole('button', { name: 'Play next Charlie' }))

		const sheet = await openQueueSheet(user)

		expect(upNextTitlesInSheet(sheet)).toEqual(['Charlie Song', 'Bravo Song'])
	})

	test('play next under StrictMode still inserts before add-to-up-next tail', async () => {
		const user = userEvent.setup()
		mockSpineAndHydration(vi.mocked(fetch))

		render(
			<StrictMode>
				<AudioPlayerProvider>
					<WarmPlaybackControls />
				</AudioPlayerProvider>
			</StrictMode>,
		)
		await startWarmLibraryPlayback(user)
		await user.click(screen.getByRole('button', { name: 'Add Bravo to up next' }))
		await user.click(screen.getByRole('button', { name: 'Play next Charlie' }))

		const sheet = await openQueueSheet(user)

		expect(upNextTitlesInSheet(sheet)).toEqual(['Charlie Song', 'Bravo Song'])
	})

	test('play next on queue-only bar inserts at front of Up Next instead of replacing current', async () => {
		const user = userEvent.setup()

		renderQueueApp(<IdleQueueControls />)
		await user.click(screen.getByRole('button', { name: 'Add Bravo to up next' }))
		await user.click(screen.getByRole('button', { name: 'Play next Charlie' }))

		const sheet = await openQueueSheet(user)

		expect(upNextTitlesInSheet(sheet)).toEqual(['Charlie Song', 'Bravo Song'])
		expect(within(sheet).queryByText('Now playing')).toBeNull()
	})

	test('stacked play next keeps FIFO order at the front of Up Next', async () => {
		const user = userEvent.setup()
		mockSpineAndHydration(vi.mocked(fetch))

		renderQueueApp(<WarmPlaybackControls />)
		await startWarmLibraryPlayback(user)
		await user.click(screen.getByRole('button', { name: 'Play next Bravo' }))
		await user.click(screen.getByRole('button', { name: 'Play next Charlie' }))

		const sheet = await openQueueSheet(user)

		expect(upNextTitlesInSheet(sheet)).toEqual(['Bravo Song', 'Charlie Song'])
	})

	test('add to queue appends after the spine and shows in the queue sheet', async () => {
		const user = userEvent.setup()
		mockSpineAndHydration(vi.mocked(fetch))

		renderQueueApp(<WarmPlaybackControls />)
		await startWarmLibraryPlayback(user)
		await user.click(screen.getByRole('button', { name: 'Add Charlie to queue' }))

		const sheet = await openQueueSheet(user)

		expect(spineTitlesInSheet(sheet)).toEqual([
			'Bravo Song',
			'Charlie Song',
			'Charlie Song',
		])
	})

	test('idle add to up next opens queue-only bar and lists the track', async () => {
		const user = userEvent.setup()

		renderQueueApp(<IdleQueueControls />)
		await user.click(screen.getByRole('button', { name: 'Add Bravo to up next' }))

		expect(screen.getByTestId('player-queue-only-bar')).toBeTruthy()

		const sheet = await openQueueSheet(user)

		expect(upNextTitlesInSheet(sheet)).toEqual(['Bravo Song'])
	})

	test('idle add to queue lists the track in the spine section', async () => {
		const user = userEvent.setup()

		renderQueueApp(<IdleQueueControls />)
		await user.click(screen.getByRole('button', { name: 'Add Charlie to queue' }))

		const sheet = await openQueueSheet(user)

		expect(within(sheet).getByText('From Queue')).toBeTruthy()
		expect(spineTitlesInSheet(sheet)).toEqual(['Charlie Song'])
	})

	test('next track updates now playing in the queue sheet', async () => {
		const user = userEvent.setup()
		mockSpineAndHydration(vi.mocked(fetch))

		renderQueueApp(<WarmPlaybackControls />)
		await startWarmLibraryPlayback(user)

		let sheet = await openQueueSheet(user)
		expect(nowPlayingTitleInSheet(sheet)).toBe('Alpha Song')
		expect(spineTitlesInSheet(sheet)).toEqual(['Bravo Song', 'Charlie Song'])

		await user.keyboard('{Escape}')
		await clickNextTrack(user)
		await waitFor(() => {
			expect(
				within(screen.getByTestId('player-desktop-bar')).getByText('Bravo Song'),
			).toBeTruthy()
		})

		sheet = await openQueueSheet(user)
		expect(nowPlayingTitleInSheet(sheet)).toBe('Bravo Song')
		expect(spineTitlesInSheet(sheet)).toEqual(['Charlie Song'])
	})

	test('removing an up next track updates the queue sheet', async () => {
		const user = userEvent.setup()
		mockSpineAndHydration(vi.mocked(fetch))

		renderQueueApp(<WarmPlaybackControls />)
		await startWarmLibraryPlayback(user)
		await user.click(screen.getByRole('button', { name: 'Add Bravo to up next' }))

		const sheet = await openQueueSheet(user)
		expect(upNextTitlesInSheet(sheet)).toEqual(['Bravo Song'])

		const upNextSection = within(sheet).getByText('Up Next').closest('section')
		if (!upNextSection) throw new Error('Expected Up Next section')
		await user.click(removeTrackInSection(upNextSection, 'Bravo Song'))

		expect(within(sheet).queryByText('Up Next')).toBeNull()
		expect(spineTitlesInSheet(sheet)).toEqual(['Bravo Song', 'Charlie Song'])
	})

	test('removing a spine track updates the queue sheet', async () => {
		const user = userEvent.setup()
		mockSpineAndHydration(vi.mocked(fetch))

		renderQueueApp(<WarmPlaybackControls />)
		await startWarmLibraryPlayback(user)

		const sheet = await openQueueSheet(user)
		expect(spineTitlesInSheet(sheet)).toEqual(['Bravo Song', 'Charlie Song'])

		await user.click(within(sheet).getByRole('button', { name: 'Remove Bravo Song from queue' }))

		expect(spineTitlesInSheet(sheet)).toEqual(['Charlie Song'])
	})

	test('shows up next tracks when more than the virtual list threshold', async () => {
		const user = userEvent.setup()
		mockSpineAndHydration(vi.mocked(fetch))
		const bulkTracks = buildPlayableTracks(25, 'UpNext')

		function BulkUpNextControls() {
			const { playTrack, playNextTrack } = useAudioPlayer()
			return (
				<>
					<button
						type="button"
						onClick={() => playTrack(trackA, { type: 'library' }, 0)}
					>
						Start library playback
					</button>
					<button
						type="button"
						onClick={() => {
							for (const track of bulkTracks) {
								playNextTrack(track)
							}
						}}
					>
						Stack bulk up next
					</button>
				</>
			)
		}

		renderQueueApp(<BulkUpNextControls />)
		await startWarmLibraryPlayback(user)
		await user.click(screen.getByRole('button', { name: 'Stack bulk up next' }))

		const sheet = await openQueueSheet(user)

		expect(within(sheet).getByText('Up Next')).toBeTruthy()
		expect(upNextTitlesInSheet(sheet).length).toBeGreaterThan(20)
		expect(upNextTitlesInSheet(sheet).slice(0, 3)).toEqual(['UpNext 1', 'UpNext 2', 'UpNext 3'])
	})

	test('shuffle toggle keeps upcoming spine tracks visible in the queue sheet', async () => {
		const user = userEvent.setup()
		mockSpineAndHydration(vi.mocked(fetch))

		renderQueueApp(<WarmPlaybackControls />)
		await startWarmLibraryPlayback(user)

		const desktopBar = screen.getByTestId('player-desktop-bar')
		await user.click(within(desktopBar).getByLabelText('Shuffle: off'))

		const sheet = await openQueueSheet(user)

		expect(within(sheet).queryByText('Queue is Empty')).toBeNull()
		expect(spineTitlesInSheet(sheet)).toHaveLength(2)
		expect(queueTrackRemoveButtonsInSheet(sheet).length).toBeGreaterThanOrEqual(3)
	})

	test('loop all toggle keeps upcoming spine tracks visible in the queue sheet', async () => {
		const user = userEvent.setup()
		mockSpineAndHydration(vi.mocked(fetch))

		renderQueueApp(<WarmPlaybackControls />)
		await startWarmLibraryPlayback(user)

		const desktopBar = screen.getByTestId('player-desktop-bar')
		await user.click(within(desktopBar).getByLabelText('Loop: off'))

		const sheet = await openQueueSheet(user)

		expect(within(sheet).queryByText('Queue is Empty')).toBeNull()
		expect(spineTitlesInSheet(sheet)).toEqual(['Bravo Song', 'Charlie Song'])
	})
})

describe('track list item queue integration', () => {
	test('clicking a library row starts playback and shows upcoming tracks in the queue sheet', async () => {
		const user = userEvent.setup()
		mockSpineAndHydration(vi.mocked(fetch))

		renderQueueApp(<LibraryRowPlayAlpha />)
		await user.click(screen.getByRole('gridcell', { name: /Track 1: Alpha Song/i }))

		await waitFor(() => {
			expect(within(screen.getByTestId('player-desktop-bar')).getByText('Alpha Song')).toBeTruthy()
		})

		const sheet = await openQueueSheet(user)

		expect(nowPlayingTitleInSheet(sheet)).toBe('Alpha Song')
		expect(spineTitlesInSheet(sheet)).toEqual(['Bravo Song', 'Charlie Song'])
	})

	test('Add to up next from track row menu shows the track in the queue sheet', async () => {
		const user = userEvent.setup()
		mockSpineAndHydration(vi.mocked(fetch))

		renderQueueApp(
			<>
				<WarmPlaybackControls />
				<LibraryRowPlayNext />
			</>,
		)
		await startWarmLibraryPlayback(user)
		await user.click(screen.getByRole('button', { name: 'More actions' }))
		await user.click(screen.getByText('Add to up next'))

		const sheet = await openQueueSheet(user)

		expect(upNextTitlesInSheet(sheet)).toEqual(['Charlie Song'])
	})

	test('Play next from track row menu inserts at the front of Up Next', async () => {
		const user = userEvent.setup()
		mockSpineAndHydration(vi.mocked(fetch))

		renderQueueApp(
			<>
				<WarmPlaybackControls />
				<LibraryRowPlayNext />
			</>,
		)
		await startWarmLibraryPlayback(user)
		await user.click(screen.getByRole('button', { name: 'Add Bravo to up next' }))
		await user.click(screen.getByRole('button', { name: 'More actions' }))
		await user.click(screen.getByText('Play next'))

		const sheet = await openQueueSheet(user)

		expect(upNextTitlesInSheet(sheet)).toEqual(['Charlie Song', 'Bravo Song'])
	})

	test('uses From Playlist heading when play context is a playlist', async () => {
		const user = userEvent.setup()
		const fetchMock = vi.mocked(fetch)
		fetchMock.mockImplementation((input: RequestInfo | URL) => {
			const url = String(input)
			if (url.includes('/api/queue-spine')) {
				return Promise.resolve({
					ok: true,
					json: async () => ({ tracks: spineTracks, total: spineTracks.length }),
				} as Response)
			}
			return Promise.resolve({
				ok: true,
				json: async () => ({ tracks: [trackA] }),
			} as Response)
		})

		function PlaylistPlayback() {
			const { playTrack } = useAudioPlayer()
			return (
				<button
					type="button"
					onClick={() => playTrack(trackA, { type: 'playlist', playlistId: 'p1' }, 0)}
				>
					Start playlist playback
				</button>
			)
		}

		renderQueueApp(<PlaylistPlayback />)
		await user.click(screen.getByRole('button', { name: 'Start playlist playback' }))
		await waitFor(() => {
			expect(within(screen.getByTestId('player-desktop-bar')).getByText('Alpha Song')).toBeTruthy()
		})

		const sheet = await openQueueSheet(user)

		expect(within(sheet).getByText('From Playlist')).toBeTruthy()
		expect(
			await within(sheet).findByRole('heading', {
				name: 'Queue (3 from playlist)',
			}),
		).toBeTruthy()
		expect(spineTitlesInSheet(sheet)).toEqual(['Bravo Song', 'Charlie Song'])
	})

	test('playUserPlaylist loads playlist spine into the queue sheet', async () => {
		const user = userEvent.setup()
		mockSpineAndHydration(vi.mocked(fetch))

		function PlaylistPlayAllControls() {
			const { playUserPlaylist } = useAudioPlayer()
			return (
				<button type="button" onClick={() => void playUserPlaylist('p1')}>
					Play playlist
				</button>
			)
		}

		renderQueueApp(<PlaylistPlayAllControls />)
		await user.click(screen.getByRole('button', { name: 'Play playlist' }))
		await waitFor(() => {
			expect(within(screen.getByTestId('player-desktop-bar')).getByText('Alpha Song')).toBeTruthy()
		})

		const sheet = await openQueueSheet(user)

		expect(within(sheet).getByText('From Playlist')).toBeTruthy()
		expect(nowPlayingTitleInSheet(sheet)).toBe('Alpha Song')
		expect(spineTitlesInSheet(sheet)).toEqual(['Bravo Song', 'Charlie Song'])
	})

	test('non-playable tracks are not added to up next', async () => {
		const user = userEvent.setup()
		mockSpineAndHydration(vi.mocked(fetch))

		const metadataOnlyTrack: FullTrack = {
			...trackB,
			id: 'metadata-only',
			title: 'Metadata Only',
			audioFiles: [],
		}

		function NonPlayableUpNextControls() {
			const { playTrack, addToUpNext } = useAudioPlayer()
			return (
				<>
					<button
						type="button"
						onClick={() => playTrack(trackA, { type: 'library' }, 0)}
					>
						Start library playback
					</button>
					<button type="button" onClick={() => addToUpNext(trackB)}>
						Add Bravo to up next
					</button>
					<button type="button" onClick={() => addToUpNext(metadataOnlyTrack)}>
						Add metadata to up next
					</button>
				</>
			)
		}

		renderQueueApp(<NonPlayableUpNextControls />)
		await startWarmLibraryPlayback(user)
		await user.click(screen.getByRole('button', { name: 'Add Bravo to up next' }))
		await user.click(screen.getByRole('button', { name: 'Add metadata to up next' }))

		const sheet = await openQueueSheet(user)

		expect(upNextTitlesInSheet(sheet)).toEqual(['Bravo Song'])
	})
})
