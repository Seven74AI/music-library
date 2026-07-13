/**
 * @vitest-environment jsdom
 *
 * TrackListItem UI tests. Queue action *behavior* (order, queue sheet visibility) lives in
 * audio-player-queue.integration.test.tsx — these tests only cover menu wiring and visibility.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ComponentProps, type ReactNode } from 'react'
import { beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { type FullTrack } from '#app/types/frontend/shared'
import { TrackListItem } from './track-list-item'

const mockPlayTrack = vi.fn()
const mockPlayNextTrack = vi.fn()
const mockAddToUpNext = vi.fn()
const mockAddToQueue = vi.fn()
const mockToast = vi.fn()

let mockPlayerState: {
	currentTrack: FullTrack | null
	currentIndex: number
	isPlayerVisible: boolean
} = {
	currentTrack: null,
	currentIndex: 0,
	isPlayerVisible: false,
}

vi.mock('./audio-player-provider', () => ({
	AudioPlayerProvider: ({ children }: { children: ReactNode }) => children,
	useAudioPlayer: () => ({
		currentTrack: mockPlayerState.currentTrack,
		currentIndex: mockPlayerState.currentIndex,
		isPlayerVisible: mockPlayerState.isPlayerVisible,
		playTrack: mockPlayTrack,
		playNextTrack: mockPlayNextTrack,
		addToUpNext: mockAddToUpNext,
		addToQueue: mockAddToQueue,
	}),
}))

vi.mock('#app/components/ui/use-toast.ts', () => ({
	toast: (...args: unknown[]) => mockToast(...args),
}))

let mockIsMobile = false
vi.mock('#app/utils/use-mobile.ts', () => ({
	useIsMobile: () => mockIsMobile,
}))

// jsdom doesn't implement matchMedia — stub it so useIsMobile() works
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
})

const mockTrack = {
	id: 'track-1',
	title: 'Test Song',
	artist: { id: 'artist-1', name: 'Test Artist' },
	duration: 180,
	coverImage: null,
	thumbnailUrl: null,
	serviceUrl: 'https://youtube.com/watch?v=test',
	service: { displayName: 'YouTube', logoUrl: null },
	audioFiles: [],
	isInUserLibrary: true,
}

const playableTrack = {
	...mockTrack,
	audioFiles: [{ id: 'af-1', format: 'mp3', objectKey: 'audio/test.mp3' }],
}

const mockUserTrack = {
	createdAt: new Date('2024-01-01').toISOString(),
}

function renderTrackListItem(props: Partial<ComponentProps<typeof TrackListItem>> = {}) {
	return render(
		<TrackListItem
			track={mockTrack}
			userTrack={mockUserTrack}
			index={0}
			{...props}
		/>,
	)
}

beforeEach(() => {
	mockIsMobile = false
	mockPlayerState = {
		currentTrack: null,
		currentIndex: 0,
		isPlayerVisible: false,
	}
	mockPlayTrack.mockReset()
	mockPlayNextTrack.mockReset()
	mockAddToUpNext.mockReset()
	mockAddToQueue.mockReset()
	mockToast.mockReset()
})

test('renders itemActions render prop when provided', () => {
	renderTrackListItem({
		itemActions: ({ trackId, isInLibrary, isDeleted }) => (
			<span data-testid="custom-action">
				{trackId}-{isInLibrary ? 'lib' : 'nolib'}-{isDeleted ? 'del' : 'ok'}
			</span>
		),
	})

	const el = screen.getByTestId('custom-action')
	expect(el).toBeDefined()
	expect(el.textContent).toBe('track-1-lib-ok')
})

test('itemActions receives correct props when track is deleted', () => {
	let captured: { trackId: string; isInLibrary: boolean; isDeleted: boolean } | null = null

	renderTrackListItem({
		track: { ...mockTrack, isInUserLibrary: false },
		index: 2,
		isDeleted: true,
		itemActions: (props) => {
			captured = props
			return <span data-testid="deleted-action">deleted</span>
		},
	})

	expect(screen.getByTestId('deleted-action')).toBeDefined()
	expect(captured).toEqual({
		trackId: 'track-1',
		isInLibrary: false,
		isDeleted: true,
	})
})

test('itemActions receives correct props when isInUserLibrary is undefined', () => {
	let captured: { trackId: string; isInLibrary: boolean; isDeleted: boolean } | null = null

	renderTrackListItem({
		track: { ...mockTrack, isInUserLibrary: undefined },
		itemActions: (props) => {
			captured = props
			return <span data-testid="nolib-action">nolib</span>
		},
	})

	expect(screen.getByTestId('nolib-action')).toBeDefined()
	expect(captured!.isInLibrary).toBe(false)
	expect(captured!.isDeleted).toBe(false)
})

test('does not render itemActions when not provided', () => {
	renderTrackListItem()

	// Track title should still render
	expect(screen.getByText('Test Song')).toBeDefined()
	// No data-testid elements from our render prop
	expect(screen.queryByTestId('custom-action')).toBeNull()
})

test('shows Add to Playlist when playlists is an empty array', async () => {
	const user = userEvent.setup()

	renderTrackListItem({ playlists: [] })

	await user.click(screen.getByRole('button', { name: 'More actions' }))
	expect(screen.getByText('Add to Playlist')).toBeDefined()
})

test('hides queue actions when track has no audio files', async () => {
	const user = userEvent.setup()

	renderTrackListItem()

	await user.click(screen.getByRole('button', { name: 'More actions' }))
	expect(screen.queryByText('Play next')).toBeNull()
	expect(screen.queryByText('Add to up next')).toBeNull()
	expect(screen.queryByText('Add to queue')).toBeNull()
})

test('shows queue actions when track has audio files', async () => {
	const user = userEvent.setup()

	renderTrackListItem({ track: playableTrack })

	await user.click(screen.getByRole('button', { name: 'More actions' }))
	expect(screen.getByText('Play next')).toBeDefined()
	expect(screen.getByText('Add to up next')).toBeDefined()
	expect(screen.getByText('Add to queue')).toBeDefined()
})

test('mobile more-actions button opens sheet without starting playback', async () => {
	mockIsMobile = true
	const user = userEvent.setup()

	renderTrackListItem({ track: playableTrack })

	await user.click(screen.getByRole('button', { name: 'More actions' }))

	expect(screen.getByText('View track details')).toBeDefined()
	expect(mockPlayTrack).not.toHaveBeenCalled()
})

test('mobile actions sheet dismiss does not start playback', async () => {
	mockIsMobile = true
	const user = userEvent.setup()

	renderTrackListItem({ track: playableTrack })

	await user.click(screen.getByRole('button', { name: 'More actions' }))
	await user.click(screen.getByText('Play next'))

	expect(mockPlayNextTrack).toHaveBeenCalled()
	expect(mockPlayTrack).not.toHaveBeenCalled()
})
