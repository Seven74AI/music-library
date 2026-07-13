import { beforeEach, describe, expect, test, vi } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { markAllNotificationsRead } from './notifications.server.ts'

vi.mock('#app/utils/db.server.ts', () => ({
	prisma: {
		userNotification: {
			count: vi.fn(),
			findMany: vi.fn(),
			updateMany: vi.fn(),
		},
	},
}))

const mockFindMany = prisma.userNotification.findMany as ReturnType<typeof vi.fn>
const mockUpdateMany = prisma.userNotification.updateMany as ReturnType<
	typeof vi.fn
>

beforeEach(() => {
	vi.clearAllMocks()
})

describe('markAllNotificationsRead', () => {
	test('marks only the specific unread notifications that were snapshotted', async () => {
		const unreadIds = [
			{ id: 'n1' },
			{ id: 'n2' },
			{ id: 'n3' },
		]

		mockFindMany.mockResolvedValueOnce(unreadIds)
		mockUpdateMany.mockResolvedValueOnce({ count: 3 })

		const result = await markAllNotificationsRead('user-1')

		// Only the snapshot IDs should be passed to updateMany
		expect(mockUpdateMany).toHaveBeenCalledWith({
			where: { id: { in: ['n1', 'n2', 'n3'] } },
			data: { readAt: expect.any(Date) },
		})

		expect(result).toBe(3)
	})

	test('race condition: a notification created after snapshot is NOT marked read', async () => {
		// Simulate: at time of snapshot, only n1 and n2 are unread
		const unreadIds = [{ id: 'n1' }, { id: 'n2' }]

		mockFindMany.mockResolvedValueOnce(unreadIds)
		mockUpdateMany.mockResolvedValueOnce({ count: 2 })

		await markAllNotificationsRead('user-1')

		// updateMany receives only n1, n2 — NOT n3 (which might have been
		// created between findMany and updateMany)
		expect(mockUpdateMany).toHaveBeenCalledWith({
			where: { id: { in: ['n1', 'n2'] } },
			data: { readAt: expect.any(Date) },
		})
	})

	test('returns 0 immediately when there are no unread notifications', async () => {
		mockFindMany.mockResolvedValueOnce([])

		const result = await markAllNotificationsRead('user-1')

		expect(result).toBe(0)
		// updateMany should never be called when the snapshot is empty
		expect(mockUpdateMany).not.toHaveBeenCalled()
	})

	test('uses userId in the findMany query to scope the snapshot', async () => {
		mockFindMany.mockResolvedValueOnce([{ id: 'n1' }])
		mockUpdateMany.mockResolvedValueOnce({ count: 1 })

		await markAllNotificationsRead('user-42')

		expect(mockFindMany).toHaveBeenCalledWith({
			where: { userId: 'user-42', readAt: null },
			select: { id: true },
		})
	})

	test('returns the count from updateMany', async () => {
		mockFindMany.mockResolvedValueOnce([{ id: 'n1' }])
		mockUpdateMany.mockResolvedValueOnce({ count: 1 })

		const result = await markAllNotificationsRead('user-1')

		expect(result).toBe(1)
	})
})
