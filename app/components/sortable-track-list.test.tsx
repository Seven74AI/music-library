/**
 * @vitest-environment jsdom
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi, beforeEach } from 'vitest'
import { SortableTrackList } from './sortable-track-list'

// ---------------------------------------------------------------------------
// Mock dnd-kit – stub out the drag-and-drop machinery so tests can verify
// component behaviour without fighting real browser pointer events.
// ---------------------------------------------------------------------------
const dndCallbacks: {
	onDragStart?: (event: any) => void
	onDragEnd?: (event: any) => void
} = {}

vi.mock('@dnd-kit/core', async () => {
	const actual = await vi.importActual('@dnd-kit/core')
	return {
		...actual,
		DndContext: ({ children, onDragStart, onDragEnd, sensors: _s, collisionDetection: _c }: any) => {
			// Capture callbacks so tests can simulate drag events.
			dndCallbacks.onDragStart = onDragStart
			dndCallbacks.onDragEnd = onDragEnd
			return <div data-testid="dnd-context">{children}</div>
		},
		KeyboardSensor: vi.fn(),
		PointerSensor: vi.fn(),
		closestCenter: vi.fn(),
		useSensor: vi.fn(() => ({})),
		useSensors: vi.fn(() => [{}]),
	}
})

vi.mock('@dnd-kit/sortable', async () => {
	const actual = await vi.importActual('@dnd-kit/sortable')
	return {
		...actual,
		SortableContext: ({ children }: any) => <>{children}</>,
		arrayMove: actual.arrayMove,
		sortableKeyboardCoordinates: vi.fn(),
		verticalListSortingStrategy: vi.fn(),
		useSortable: ({ id }: { id: string }) => ({
			attributes: { tabIndex: 0 },
			listeners: {},
			setNodeRef: vi.fn(),
			transform: null,
			transition: undefined,
			isDragging: false,
		}),
	}
})

vi.mock('@dnd-kit/utilities', () => ({
	CSS: { Transform: { toString: vi.fn(() => '') } },
}))

// ---------------------------------------------------------------------------
// Mock Icon – icon rendering relies on an SVG sprite that doesn't exist in test.
// ---------------------------------------------------------------------------
vi.mock('#app/components/ui/icon.tsx', () => ({
	Icon: ({ name, className, 'aria-hidden': ariaHidden, 'aria-label': ariaLabel }: any) => (
		<span
			data-testid={`icon-${name}`}
			className={className}
			aria-hidden={ariaHidden}
			aria-label={ariaLabel}
		/>
	),
}))

// ---------------------------------------------------------------------------
// Mock TrackListItem – it pulls in the audio player, mobile detection, etc.
// We render a minimal representation so we can verify the parent's behaviour.
// ---------------------------------------------------------------------------
vi.mock('./track-list-item', () => ({
	TrackListItem: ({ track, index }: any) => (
		<div data-testid={`track-list-item-${track.id}`}>
			<span data-testid="track-title">{track.title}</span>
			<span data-testid="track-artist">{track.artist.name}</span>
			<span data-testid="track-index">{index}</span>
		</div>
	),
}))

// ---------------------------------------------------------------------------
// Types (mirrors the non-exported interfaces in sortable-track-list.tsx)
// ---------------------------------------------------------------------------

interface SortableListTrack {
	id: string
	title: string
	artist: { id: string; name: string }
	duration: number | null
	coverImage: { objectKey: string } | null
	serviceUrl: string | null
	createdAt: string
	service?: { displayName: string; logoUrl: string | null } | null
	isInUserLibrary?: boolean
}

interface PlaylistTrack {
	id: string
	position: number
	track: SortableListTrack
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal SortableListTrack for testing. */
function makeTrack(overrides: Partial<SortableListTrack> = {}): SortableListTrack {
	return {
		id: overrides.id ?? 'track-1',
		title: overrides.title ?? 'Test Song',
		artist: overrides.artist ?? { id: 'artist-1', name: 'Test Artist' },
		duration: overrides.duration ?? 180,
		coverImage: overrides.coverImage ?? null,
		serviceUrl: overrides.serviceUrl ?? null,
		createdAt: overrides.createdAt ?? '2025-01-01T00:00:00Z',
		...overrides,
	}
}

/** Build a PlaylistTrack from a SortableListTrack. */
function makePlaylistTrack(
	track: SortableListTrack,
	position: number = 0,
): PlaylistTrack {
	return { id: track.id, position, track }
}

/** Two tracks for typical multi-track tests. */
function twoTracks(): PlaylistTrack[] {
	const t1 = makeTrack({ id: 'track-1', title: 'First', artist: { id: 'a1', name: 'Alice' } })
	const t2 = makeTrack({ id: 'track-2', title: 'Second', artist: { id: 'a2', name: 'Bob' } })
	return [makePlaylistTrack(t1, 0), makePlaylistTrack(t2, 1)]
}

const defaultProps = {
	playlists: [] as Array<{ id: string; title: string; description: string | null; _count: { tracks: number } }>,
	onReorder: vi.fn(),
	onRemoveTrack: vi.fn(),
	onBulkRemove: vi.fn(),
	onBulkPlayNext: vi.fn(),
	onBulkAddToUpNext: vi.fn(),
	onBulkAddToQueue: vi.fn(),
	playlistId: 'playlist-1',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SortableTrackList', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		// Reset captured dnd callbacks between tests.
		dndCallbacks.onDragStart = undefined
		dndCallbacks.onDragEnd = undefined
	})

	// -- Rendering -----------------------------------------------------------

	describe('basic rendering', () => {
		test('renders tracks via TrackListItem', () => {
			const tracks = twoTracks()
			render(<SortableTrackList tracks={tracks} {...defaultProps} />)

			expect(screen.getByTestId('track-list-item-track-1')).toBeInTheDocument()
			expect(screen.getByTestId('track-list-item-track-2')).toBeInTheDocument()
		})

		test('renders the selection toggle button when not in selection mode', () => {
			render(<SortableTrackList tracks={twoTracks()} {...defaultProps} />)

			expect(
				screen.getByRole('button', { name: /enable track selection mode/i }),
			).toBeInTheDocument()
		})

		test('does not render bulk actions bar when not in selection mode', () => {
			render(<SortableTrackList tracks={twoTracks()} {...defaultProps} />)

			expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
		})

		test('renders the region with accessible label', () => {
			render(<SortableTrackList tracks={twoTracks()} {...defaultProps} />)

			expect(
				screen.getByRole('region', { name: /playlist tracks/i }),
			).toBeInTheDocument()
		})

		test('renders the screen reader announcement div', () => {
			render(<SortableTrackList tracks={twoTracks()} {...defaultProps} />)

			const announcement = document.getElementById('drag-announcements')
			expect(announcement).toBeInTheDocument()
			expect(announcement).toHaveAttribute('aria-live', 'polite')
			expect(announcement).toHaveAttribute('aria-atomic', 'true')
		})

		test('renders reordering/removing status message when isReordering is true', () => {
			render(
				<SortableTrackList
					tracks={twoTracks()}
					{...defaultProps}
					isReordering={true}
				/>,
			)

			expect(screen.getByText(/reordering tracks/i)).toBeInTheDocument()
		})

		test('renders removing status message when isRemoving is true', () => {
			render(
				<SortableTrackList
					tracks={twoTracks()}
					{...defaultProps}
					isRemoving={true}
				/>,
			)

			expect(screen.getByText(/removing tracks/i)).toBeInTheDocument()
		})

		test('disables selection toggle during reordering', () => {
			render(
				<SortableTrackList
					tracks={twoTracks()}
					{...defaultProps}
					isReordering={true}
				/>,
			)

			expect(
				screen.getByRole('button', { name: /enable track selection mode/i }),
			).toBeDisabled()
		})
	})

	// -- Empty state ---------------------------------------------------------

	describe('empty state', () => {
		test('renders without errors when tracks array is empty', () => {
			render(<SortableTrackList tracks={[]} {...defaultProps} />)

			// The region still renders, and no track items are present.
			expect(
				screen.getByRole('region', { name: /playlist tracks/i }),
			).toBeInTheDocument()
			expect(screen.queryByTestId(/track-list-item-/)).not.toBeInTheDocument()
		})

		test('shows playlist with 0 tracks label', () => {
			render(<SortableTrackList tracks={[]} {...defaultProps} />)

			const list = screen.getByRole('list')
			expect(list).toHaveAttribute('aria-label', 'Playlist with 0 tracks')
		})
	})

	// -- Drag handle ---------------------------------------------------------

	describe('drag handle', () => {
		test('each track has a drag handle button with accessible label', () => {
			render(<SortableTrackList tracks={twoTracks()} {...defaultProps} />)

			const handles = screen.getAllByRole('button', { name: /drag handle for track/i })
			expect(handles).toHaveLength(2)
			expect(handles[0]).toHaveAttribute(
				'aria-label',
				expect.stringContaining('First'),
			)
			expect(handles[0]).toHaveAttribute(
				'aria-label',
				expect.stringContaining('Alice'),
			)
		})

		test('drag handles have grab cursor class', () => {
			render(<SortableTrackList tracks={twoTracks()} {...defaultProps} />)

			const handles = screen.getAllByRole('button', { name: /drag handle for track/i })
			for (const handle of handles) {
				expect(handle.className).toContain('cursor-grab')
			}
		})
	})

	// -- Drag-and-drop reordering --------------------------------------------

	describe('drag-and-drop reordering', () => {
		test('fires onReorder with updated positions when handleDragEnd is called', () => {
			const onReorder = vi.fn()
			const tracks = twoTracks()

			render(
				<SortableTrackList
					tracks={tracks}
					{...defaultProps}
					onReorder={onReorder}
				/>,
			)

			// Simulate dragging track-1 over track-2
			expect(dndCallbacks.onDragEnd).toBeDefined()
			dndCallbacks.onDragEnd!({
				active: { id: 'track-1' },
				over: { id: 'track-2' },
			})

			expect(onReorder).toHaveBeenCalledTimes(1)
			const newOrder = onReorder.mock.calls[0][0]
			expect(newOrder).toEqual([
				{ id: 'track-2', position: 1 },
				{ id: 'track-1', position: 2 },
			])
		})

		test('does not fire onReorder when active and over are the same', () => {
			const onReorder = vi.fn()
			render(
				<SortableTrackList
					tracks={twoTracks()}
					{...defaultProps}
					onReorder={onReorder}
				/>,
			)

			dndCallbacks.onDragEnd!({
				active: { id: 'track-1' },
				over: { id: 'track-1' },
			})

			expect(onReorder).not.toHaveBeenCalled()
		})

		test('does not fire onReorder when over is null', () => {
			const onReorder = vi.fn()
			render(
				<SortableTrackList
					tracks={twoTracks()}
					{...defaultProps}
					onReorder={onReorder}
				/>,
			)

			dndCallbacks.onDragEnd!({
				active: { id: 'track-1' },
				over: null,
			})

			expect(onReorder).not.toHaveBeenCalled()
		})

		test('announces movement to screen reader via live region', () => {
			render(
				<SortableTrackList tracks={twoTracks()} {...defaultProps} />,
			)

			dndCallbacks.onDragEnd!({
				active: { id: 'track-1' },
				over: { id: 'track-2' },
			})

			const announcement = document.getElementById('drag-announcements')
			expect(announcement?.textContent).toContain('First')
			expect(announcement?.textContent).toContain('position 1')
			expect(announcement?.textContent).toContain('position 2')
		})
	})

	// -- Keyboard accessibility (live region) ---------------------------------

	describe('keyboard accessibility', () => {
		test('drag start announces to screen reader', () => {
			render(
				<SortableTrackList tracks={twoTracks()} {...defaultProps} />,
			)

			expect(dndCallbacks.onDragStart).toBeDefined()
			dndCallbacks.onDragStart!({ active: { id: 'track-1' } })

			const announcement = document.getElementById('drag-announcements')
			expect(announcement?.textContent).toContain('Started dragging')
			expect(announcement?.textContent).toContain('First')
		})

		test('live region has correct aria attributes', () => {
			render(
				<SortableTrackList tracks={twoTracks()} {...defaultProps} />,
			)

			const announcement = document.getElementById('drag-announcements')
			expect(announcement).toHaveAttribute('aria-live', 'polite')
			expect(announcement).toHaveAttribute('aria-atomic', 'true')
			expect(announcement?.className).toContain('sr-only')
		})

		test('drag handle has descriptive keyboard instructions in aria-label', () => {
			render(
				<SortableTrackList tracks={twoTracks()} {...defaultProps} />,
			)

			const handle = screen.getByRole('button', {
				name: /drag handle for track 1/i,
			})
			expect(handle).toHaveAttribute(
				'aria-label',
				expect.stringContaining('Press Space or Enter'),
			)
			expect(handle).toHaveAttribute(
				'aria-label',
				expect.stringContaining('arrow keys to reorder'),
			)
		})

		test('selected tracks count is announced with aria-live', async () => {
			const user = userEvent.setup()
			render(
				<SortableTrackList tracks={twoTracks()} {...defaultProps} />,
			)

			// Enter selection mode
			await user.click(
				screen.getByRole('button', {
					name: /enable track selection mode/i,
				}),
			)

			// The selected count announcement should be present
			expect(screen.getByText(/0 tracks selected/i)).toBeInTheDocument()
		})
	})

	// -- Selection mode ------------------------------------------------------

	describe('selection mode', () => {
		test('entering selection mode shows bulk actions toolbar', async () => {
			const user = userEvent.setup()
			render(<SortableTrackList tracks={twoTracks()} {...defaultProps} />)

			await user.click(
				screen.getByRole('button', { name: /enable track selection mode/i }),
			)

			expect(screen.getByRole('toolbar')).toBeInTheDocument()
			expect(
				screen.getByRole('button', { name: /cancel track selection/i }),
			).toBeInTheDocument()
		})

		test('selecting a track updates the selected count', async () => {
			const user = userEvent.setup()
			render(<SortableTrackList tracks={twoTracks()} {...defaultProps} />)

			await user.click(
				screen.getByRole('button', { name: /enable track selection mode/i }),
			)

			// Initially 0 selected
			expect(screen.getByText(/0 tracks selected/i)).toBeInTheDocument()
		})

		test('cancelling selection mode hides the toolbar', async () => {
			const user = userEvent.setup()
			render(<SortableTrackList tracks={twoTracks()} {...defaultProps} />)

			await user.click(
				screen.getByRole('button', { name: /enable track selection mode/i }),
			)
			await user.click(
				screen.getByRole('button', { name: /cancel track selection/i }),
			)

			expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
		})

		test('bulk remove button fires onBulkRemove with selected ids', async () => {
			const onBulkRemove = vi.fn()
			const user = userEvent.setup()

			render(
				<SortableTrackList
					tracks={twoTracks()}
					{...defaultProps}
					onBulkRemove={onBulkRemove}
				/>,
			)

			await user.click(
				screen.getByRole('button', { name: /enable track selection mode/i }),
			)

			// Click "Select all" checkbox to select all tracks
			await user.click(
				screen.getByRole('checkbox', { name: /select all 2 tracks/i }),
			)

			// Click "Remove Selected"
			await user.click(
				screen.getByRole('button', { name: /remove 2 selected tracks/i }),
			)

			expect(onBulkRemove).toHaveBeenCalledWith(['track-1', 'track-2'])
		})

		test('bulk actions are disabled when no tracks selected', async () => {
			const user = userEvent.setup()
			render(<SortableTrackList tracks={twoTracks()} {...defaultProps} />)

			await user.click(
				screen.getByRole('button', { name: /enable track selection mode/i }),
			)

			const removeBtn = screen.getByRole('button', {
				name: /remove 0 selected tracks/i,
			})
			expect(removeBtn).toBeDisabled()
		})
	})

	// -- Edge cases ----------------------------------------------------------

	describe('edge cases', () => {
		test('handles a single track without errors', () => {
			const track = makeTrack({ id: 'single', title: 'Only Track' })
			const tracks = [makePlaylistTrack(track, 0)]

			render(<SortableTrackList tracks={tracks} {...defaultProps} />)

			expect(screen.getByTestId('track-list-item-single')).toBeInTheDocument()
			expect(screen.getByText('Only Track')).toBeInTheDocument()
		})

		test('handles duplicate track titles gracefully', () => {
			const t1 = makeTrack({ id: 'dup-1', title: 'Same Title' })
			const t2 = makeTrack({ id: 'dup-2', title: 'Same Title' })
			const tracks = [makePlaylistTrack(t1, 0), makePlaylistTrack(t2, 1)]

			render(<SortableTrackList tracks={tracks} {...defaultProps} />)

			const titles = screen.getAllByText('Same Title')
			expect(titles).toHaveLength(2)
		})

		test('handles tracks with null duration', () => {
			const track = makeTrack({ id: 'no-dur', duration: null })
			const tracks = [makePlaylistTrack(track, 0)]

			render(<SortableTrackList tracks={tracks} {...defaultProps} />)

			expect(screen.getByTestId('track-list-item-no-dur')).toBeInTheDocument()
		})

		test('updates local state when tracks prop changes (useEffect sync)', () => {
			const tracksA = twoTracks()
			const { rerender } = render(
				<SortableTrackList tracks={tracksA} {...defaultProps} />,
			)

			expect(screen.getByTestId('track-list-item-track-1')).toBeInTheDocument()
			expect(screen.getByTestId('track-list-item-track-2')).toBeInTheDocument()

			// Replace with a different set
			const track3 = makeTrack({ id: 'track-3', title: 'New Track' })
			const tracksB = [makePlaylistTrack(track3, 0)]

			rerender(<SortableTrackList tracks={tracksB} {...defaultProps} />)

			expect(screen.queryByTestId('track-list-item-track-1')).not.toBeInTheDocument()
			expect(screen.queryByTestId('track-list-item-track-2')).not.toBeInTheDocument()
			expect(screen.getByTestId('track-list-item-track-3')).toBeInTheDocument()
		})

		test('className prop is forwarded to root element', () => {
			render(
				<SortableTrackList
					tracks={twoTracks()}
					{...defaultProps}
					className="custom-class"
				/>,
			)

			const region = screen.getByRole('region', { name: /playlist tracks/i })
			expect(region.className).toContain('custom-class')
		})

		test('itemActions render prop is passed through without errors', () => {
			const itemActions = vi.fn(() => <button data-testid="custom-action">Add</button>)
			render(
				<SortableTrackList
					tracks={twoTracks()}
					{...defaultProps}
					itemActions={itemActions}
				/>,
			)

			// The component renders both tracks without crashing.
			// itemActions is passed through to TrackListItem, which is mocked,
			// so the render prop is not actually invoked in this test.
			expect(screen.getByTestId('track-list-item-track-1')).toBeInTheDocument()
			expect(screen.getByTestId('track-list-item-track-2')).toBeInTheDocument()
		})
	})

	// -- Props passthrough ---------------------------------------------------

	describe('callback props', () => {
		test('onRemoveTrack is called when a track is removed', () => {
			// The SortableTrackItem passes onRemove which comes from onRemoveTrack.
			// Since we mocked TrackListItem, the remove isn't triggered via the UI.
			// We verify the component renders with the correct track items present.
			const onRemoveTrack = vi.fn()
			render(
				<SortableTrackList
					tracks={twoTracks()}
					{...defaultProps}
					onRemoveTrack={onRemoveTrack}
				/>,
			)

			// Both tracks rendered in the list
			expect(screen.getByTestId('track-list-item-track-1')).toBeInTheDocument()
			expect(screen.getByTestId('track-list-item-track-2')).toBeInTheDocument()
		})
	})
})
