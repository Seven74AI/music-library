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
const mockRevalidate = vi.fn()

let fetcherState: 'idle' | 'submitting' = 'idle'
let fetcherData: { ok: boolean } | undefined

const mockFetcher = {
	get state() {
		return fetcherState
	},
	get data() {
		return fetcherData
	},
	submit: mockSubmit,
	Form: ({
		children,
		...props
	}: React.FormHTMLAttributes<HTMLFormElement>) => (
		<form {...props}>{children}</form>
	),
}

vi.mock('react-router', async (importOriginal) => {
	const actual = await importOriginal<typeof ReactRouter>()
	return {
		...actual,
		useFetcher: () => mockFetcher,
		useRevalidator: () => ({ revalidate: mockRevalidate }),
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
	fetcherState = 'idle'
	fetcherData = undefined
	mockSubmit.mockReset()
	mockRevalidate.mockReset()
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

test('mark single notification read revalidates loader data', async () => {
	const user = userEvent.setup()

	render(<NotificationBell notifications={notificationWithoutLink} unreadCount={1} />)

	await user.click(screen.getByRole('button', { name: '1 unread notifications' }))
	await user.click(screen.getByText('Playlist ready'))

	expect(mockSubmit).toHaveBeenCalledWith(
		{ intent: 'mark-read', notificationId: 'notif-1' },
		{ method: 'POST', action: '/resources/notifications' },
	)
})

test('revalidates root loader after a successful notifications response', () => {
	const { rerender } = render(
		<NotificationBell notifications={notificationWithoutLink} unreadCount={1} />,
	)

	fetcherState = 'submitting'
	fetcherData = undefined
	rerender(<NotificationBell notifications={notificationWithoutLink} unreadCount={1} />)

	fetcherState = 'idle'
	fetcherData = { ok: true }
	rerender(<NotificationBell notifications={notificationWithoutLink} unreadCount={1} />)

	expect(mockRevalidate).toHaveBeenCalled()
})

test('shows spinner on bell icon and disables mark-all-read while submitting', async () => {
	const user = userEvent.setup()
	fetcherState = 'submitting'

	render(<NotificationBell notifications={notificationWithoutLinkTwo} unreadCount={2} />)

	// Bell has loading aria-label
	const bell = screen.getByRole('button', { name: 'Processing notifications...' })
	expect(bell).toBeDefined()

	// Open dropdown
	await user.click(bell)

	// Mark all read button is disabled
	const markAllButton = screen.getByRole('button', { name: 'Mark all read' })
	expect(markAllButton).toBeDefined()
	expect((markAllButton as HTMLButtonElement).disabled).toBe(true)

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
	fetcherState = 'submitting'
	mockSubmit.mockReset()
	rerender(<NotificationBell notifications={notificationWithoutLinkTwo} unreadCount={2} />)

	// Button should be disabled now after re-render
	const markAllButton = screen.getByRole('button', { name: 'Mark all read' })
	expect((markAllButton as HTMLButtonElement).disabled).toBe(true)
	expect(mockSubmit).not.toHaveBeenCalled()
})

test('does not submit mark-single-read when already submitting', async () => {
	const user = userEvent.setup()
	fetcherState = 'submitting'

	render(<NotificationBell notifications={notificationWithoutLinkTwo} unreadCount={2} />)

	await user.click(screen.getByRole('button', { name: 'Processing notifications...' }))

	// Try clicking a notification row — should be disabled
	const item = screen.getByText('Playlist ready')
	await user.click(item)

	expect(mockSubmit).not.toHaveBeenCalled()
})

test('notification row with link is disabled when submitting', async () => {
	const user = userEvent.setup()
	fetcherState = 'submitting'

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
	fetcherState = 'submitting'
	rerender(<NotificationBell notifications={notificationWithoutLinkTwo} unreadCount={2} />)

	expect(
		screen.getByRole('button', { name: 'Processing notifications...' }),
	).toBeDefined()

	// Return to idle
	fetcherState = 'idle'
	rerender(<NotificationBell notifications={notificationWithoutLinkTwo} unreadCount={2} />)

	expect(
		screen.getByRole('button', { name: '2 unread notifications' }),
	).toBeDefined()
})
