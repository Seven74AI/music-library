/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
	const actual = await importOriginal()
	return {
		...actual,
		useFetcher: () => mockFetcher,
		useRevalidator: () => ({ revalidate: mockRevalidate }),
	}
})

const notifications: NotificationItem[] = [
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

beforeEach(() => {
	fetcherState = 'idle'
	fetcherData = undefined
	mockSubmit.mockReset()
	mockRevalidate.mockReset()
})

test('mark all read submits through fetcher instead of navigating', async () => {
	const user = userEvent.setup()

	render(<NotificationBell notifications={notifications} unreadCount={1} />)

	await user.click(screen.getByRole('button', { name: '1 unread notifications' }))
	await user.click(screen.getByRole('button', { name: 'Mark all read' }))

	expect(mockSubmit).toHaveBeenCalledWith(
		{ intent: 'mark-all-read' },
		{ method: 'POST', action: '/resources/notifications' },
	)
})

test('mark single notification read revalidates loader data', async () => {
	const user = userEvent.setup()

	render(<NotificationBell notifications={notifications} unreadCount={1} />)

	await user.click(screen.getByRole('button', { name: '1 unread notifications' }))
	await user.click(screen.getByText('Playlist ready'))

	expect(mockSubmit).toHaveBeenCalledWith(
		{ intent: 'mark-read', notificationId: 'notif-1' },
		{ method: 'POST', action: '/resources/notifications' },
	)
})

test('revalidates root loader after a successful notifications response', () => {
	const { rerender } = render(
		<NotificationBell notifications={notifications} unreadCount={1} />,
	)

	fetcherState = 'submitting'
	fetcherData = undefined
	rerender(<NotificationBell notifications={notifications} unreadCount={1} />)

	fetcherState = 'idle'
	fetcherData = { ok: true }
	rerender(<NotificationBell notifications={notifications} unreadCount={1} />)

	expect(mockRevalidate).toHaveBeenCalled()
})
