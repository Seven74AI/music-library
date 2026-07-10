/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode } from 'react'
import { expect, test, beforeAll } from 'vitest'
import { AudioPlayerProvider } from './audio-player-provider'
import { TrackListItem } from './track-list-item'

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

const mockUserTrack = {
	createdAt: new Date('2024-01-01').toISOString(),
}

function renderWithProvider(ui: ReactNode) {
	return render(<AudioPlayerProvider>{ui}</AudioPlayerProvider>)
}

test('renders itemActions render prop when provided', () => {
	renderWithProvider(
		<TrackListItem
			track={mockTrack}
			userTrack={mockUserTrack}
			index={0}
			itemActions={({ trackId, isInLibrary, isDeleted }) => (
				<span data-testid="custom-action">
					{trackId}-{isInLibrary ? 'lib' : 'nolib'}-{isDeleted ? 'del' : 'ok'}
				</span>
			)}
		/>,
	)

	const el = screen.getByTestId('custom-action')
	expect(el).toBeDefined()
	expect(el.textContent).toBe('track-1-lib-ok')
})

test('itemActions receives correct props when track is deleted', () => {
	let captured: { trackId: string; isInLibrary: boolean; isDeleted: boolean } | null = null

	renderWithProvider(
		<TrackListItem
			track={{ ...mockTrack, isInUserLibrary: false }}
			userTrack={mockUserTrack}
			index={2}
			isDeleted
			itemActions={(props) => {
				captured = props
				return <span data-testid="deleted-action">deleted</span>
			}}
		/>,
	)

	expect(screen.getByTestId('deleted-action')).toBeDefined()
	expect(captured).toEqual({
		trackId: 'track-1',
		isInLibrary: false,
		isDeleted: true,
	})
})

test('itemActions receives correct props when isInUserLibrary is undefined', () => {
	let captured: { trackId: string; isInLibrary: boolean; isDeleted: boolean } | null = null

	renderWithProvider(
		<TrackListItem
			track={{ ...mockTrack, isInUserLibrary: undefined }}
			userTrack={mockUserTrack}
			index={0}
			itemActions={(props) => {
				captured = props
				return <span data-testid="nolib-action">nolib</span>
			}}
		/>,
	)

	expect(screen.getByTestId('nolib-action')).toBeDefined()
	expect(captured!.isInLibrary).toBe(false)
	expect(captured!.isDeleted).toBe(false)
})

test('does not render itemActions when not provided', () => {
	renderWithProvider(
		<TrackListItem
			track={mockTrack}
			userTrack={mockUserTrack}
			index={0}
		/>,
	)

	// Track title should still render
	expect(screen.getByText('Test Song')).toBeDefined()
	// No data-testid elements from our render prop
	expect(screen.queryByTestId('custom-action')).toBeNull()
})

test('shows Add to Playlist when playlists is an empty array', async () => {
	const user = userEvent.setup()

	renderWithProvider(
		<TrackListItem
			track={mockTrack}
			userTrack={mockUserTrack}
			index={0}
			playlists={[]}
		/>,
	)

	await user.click(screen.getByRole('button', { name: 'More actions' }))
	expect(screen.getByText('Add to Playlist')).toBeDefined()
})
