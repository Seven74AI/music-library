/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import type * as ReactRouter from 'react-router'
import { beforeEach, expect, test, vi } from 'vitest'
import { NotificationBell, type NotificationItem } from './notification-bell.tsx'

const mockSubmit = vi.fn()
const mockLoad = vi.fn()

let submitFetcherState: 'idle' | 'submitting' = 'idle'
let submitFetcherData: { ok: boolean } | undefined

let refreshFetcherState: 'idle' | 'loading' = 'idle'
let refreshFetcherData:
	| { notifications: NotificationItem[]; unreadCount: number }
	| undefined

const mockSubmitFetcher = {
	get state() {
		return submitFetcherState
	},
	get data() {
		return submitFetcherData
	},
	submit: mockSubmit,
	Form: ({
		children,
		...props
	}: React.FormHTMLAttributes<HTMLFormElement>) => (
		<form {...props}>{children}</form>
	),
}

const mockRefreshFetcher = {
	get state() {
		return refreshFetcherState
	},
	get data() {
		return refreshFetcherData
	},
	load: mockLoad,
	Form: ({
		children,
		...props
	}: React.FormHTMLAttributes<HTMLFormElement>) => (
		<form {...props}>{children}</form>
	),
}

// Return different mock fetchers based on call position within each render.
// useFetcher is called twice per render (submit fetcher first, refresh fetcher second).
// Since React hooks must be called in the same order every render, position % 2
// reliably distinguishes them across re-renders.
let fetcherCallCount = 0
vi.mock('react-router', async (importOriginal) => {
	const actual = await importOriginal<typeof ReactRouter>()
	return {
		...actual,
		useFetcher: vi.fn().mockImplementation(() => {
			fetcherCallCount++
			// Odd calls = submit fetcher, even calls = refresh fetcher
			return fetcherCallCount % 2 === 1
				? mockSubmitFetcher
				: mockRefreshFetcher
		}),
	}
})

const notificationWithoutLink: NotificationItem[] = [
	{
		id: 'notif-1',
		type: 'playlist_archive_ready',
		title: 'Playlist ready',
		body: 'All tracks archived.',
		linkUrl: null,
		readAt: null,
		createdAt: '2026-01-01T00:00:00.000Z',
	},
]

const notificationWithoutLinkTwo: NotificationItem[] = [
	{
		id: 'notif-1',
		type: 'playlist_archive_ready',
		title: 'Playlist ready',
		body: 'All tracks archived.',
		linkUrl: null,
		readAt: null,
		createdAt: '2026-01-01T00:00:00.000Z',
	},
	{
		id: 'notif-2',
		type: 'playlist_archive_ready',
		title: 'Already read',
		body: 'This one is read.',
		linkUrl: null,
		readAt: '2026-01-02T00:00:00.000Z',
		createdAt: '2026-01-02T00:00:00.000Z',
	},
]

const notificationWithLink: NotificationItem[] = [
	{
		id: 'notif-1',
		type: 'playlist_archive_ready',
		title: 'Playlist ready',
		body: 'All tracks archived.',
		linkUrl: null,
		readAt: null,
		createdAt: '2026-01-01T00:00:00.000Z',
	},
	{
		id: 'notif-2',
		type: 'playlist_archive_ready',
		title: 'Another playlist',
		body: 'More tracks archived.',
		linkUrl: '/playlists/123',
		readAt: null,
		createdAt: '2026-01-02T00:00:00.000Z',
	},
]

beforeEach(() => {
	submitFetcherState = 'idle'
	submitFetcherData = undefined
	refreshFetcherState = 'idle'
	refreshFetcherData = undefined
	mockSubmit.mockReset()
	mockLoad.mockReset()
	fetcherCallCount = 0
})

test('mark all read submits through fetcher instead of navigating', async () => {
	const user = userEvent.setup()

	render(<NotificationBell notifications={notificationWithoutLink} unreadCount={1} />)

	await user.click(screen.getByRole('button', { name: '1 unread notifications' }))
	await user.click(screen.getByRole('button', { name: 'Mark all read' }))

	expect(mockSubmit).toHaveBeenCalledWith(
		{ intent: 'mark-all-read' },
		{ method: 'POST', action: '/resources/notifications' },
	)
})

test('mark single notification read submits through fetcher', async () => {
	const user = userEvent.setup()

	render(<NotificationBell notifications={notificationWithoutLink} unreadCount={1} />)

	await user.click(screen.getByRole('button', { name: '1 unread notifications' }))
	await user.click(screen.getByText('Playlist ready'))

	expect(mockSubmit).toHaveBeenCalledWith(
		{ intent: 'mark-read', notificationId: 'notif-1' },
		{ method: 'POST', action: '/resources/notifications' },
	)
})

test('fetches fresh notification data after a successful mark-read instead of full revalidation', () => {
	const { rerender } = render(
		<NotificationBell notifications={notificationWithoutLink} unreadCount={1} />,
	)

	// Simulate submission in progress
	submitFetcherState = 'submitting'
	submitFetcherData = undefined
	rerender(<NotificationBell notifications={notificationWithoutLink} unreadCount={1} />)

	// Simulate submission complete with success
	submitFetcherState = 'idle'
	submitFetcherData = { ok: true }
	rerender(<NotificationBell notifications={notificationWithoutLink} unreadCount={1} />)

	// Should call load on the refresh fetcher to fetch fresh data
	// instead of calling revalidate (which would trigger full root loader reload)
	expect(mockLoad).toHaveBeenCalledWith('/resources/notifications')
})

test('uses fresh fetcher data when available, falls back to props', () => {
	// Render with stale props — 1 unread
	const { rerender } = render(
		<NotificationBell notifications={notificationWithoutLink} unreadCount={1} />,
	)

	// No fresh data yet — should show stale count
	expect(screen.getByLabelText('1 unread notifications')).toBeInTheDocument()

	// Simulate the refresh fetcher returning updated data
	refreshFetcherData = {
		notifications: [{ ...notificationWithoutLink[0]!, readAt: new Date().toISOString() }],
		unreadCount: 0,
	}
	rerender(<NotificationBell notifications={notificationWithoutLink} unreadCount={1} />)

	// Should show updated count from fetcher, not stale props
	expect(screen.getByLabelText('Notifications')).toBeInTheDocument()
})

test('shows spinner on bell icon and disables mark-all-read while submitting', async () => {
	const user = userEvent.setup()
	submitFetcherState = 'submitting'

	render(<NotificationBell notifications={notificationWithoutLinkTwo} unreadCount={2} />)

	// Bell has loading aria-label
	const bell = screen.getByRole('button', { name: 'Processing notifications...' })
	expect(bell).toBeDefined()

	// Open dropdown
	await user.click(bell)

	// Mark all read button is disabled
	const markAllButton = screen.getByRole('button', { name: 'Mark all read' })
	expect(markAllButton).toBeDefined()
	expect(markAllButton).toBeDisabled()

	// sr-only status text is present
	expect(screen.getByText('Processing notifications...')).toBeDefined()
})

test('does not submit mark-all-read when already submitting', async () => {
	const user = userEvent.setup()

	const { rerender } = render(
		<NotificationBell notifications={notificationWithoutLinkTwo} unreadCount={2} />,
	)

	await user.click(screen.getByRole('button', { name: '2 unread notifications' }))

	// First submit
	await user.click(screen.getByRole('button', { name: 'Mark all read' }))
	expect(mockSubmit).toHaveBeenCalledTimes(1)

	// Simulate still submitting — re-render with submitting state
	submitFetcherState = 'submitting'
	mockSubmit.mockReset()
	rerender(<NotificationBell notifications={notificationWithoutLinkTwo} unreadCount={2} />)

	// Button should be disabled now after re-render
	const markAllButton = screen.getByRole('button', { name: 'Mark all read' })
	expect(markAllButton).toBeDisabled()
	expect(mockSubmit).not.toHaveBeenCalled()
})

test('does not submit mark-single-read when already submitting', async () => {
	const user = userEvent.setup()
	submitFetcherState = 'submitting'

	render(<NotificationBell notifications={notificationWithoutLinkTwo} unreadCount={2} />)

	await user.click(screen.getByRole('button', { name: 'Processing notifications...' }))

	// Try clicking a notification row — should be disabled
	const item = screen.getByText('Playlist ready')
	await user.click(item)

	expect(mockSubmit).not.toHaveBeenCalled()
})

test('notification row with link is disabled when submitting', async () => {
	const user = userEvent.setup()
	submitFetcherState = 'submitting'

	render(
		<MemoryRouter>
			<NotificationBell notifications={notificationWithLink} unreadCount={2} />
		</MemoryRouter>,
	)

	await user.click(screen.getByRole('button', { name: 'Processing notifications...' }))

	// The second notification has a linkUrl — clicking should not submit
	const linkItem = screen.getByText('Another playlist')
	await user.click(linkItem)

	expect(mockSubmit).not.toHaveBeenCalled()
})

test('removes loading state when fetcher returns to idle', () => {
	const { rerender } = render(
		<NotificationBell notifications={notificationWithoutLinkTwo} unreadCount={2} />,
	)

	// Start submitting
	submitFetcherState = 'submitting'
	rerender(<NotificationBell notifications={notificationWithoutLinkTwo} unreadCount={2} />)

	expect(
		screen.getByRole('button', { name: 'Processing notifications...' }),
	).toBeDefined()

	// Return to idle
	submitFetcherState = 'idle'
	rerender(<NotificationBell notifications={notificationWithoutLinkTwo} unreadCount={2} />)

	expect(
		screen.getByRole('button', { name: '2 unread notifications' }),
	).toBeDefined()
})
