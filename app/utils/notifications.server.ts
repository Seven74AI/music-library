import { prisma } from '#app/utils/db.server.ts'

export async function getUnreadNotificationCount(userId: string): Promise<number> {
	return prisma.userNotification.count({
		where: {
			userId,
			readAt: null,
		},
	})
}

export async function getRecentNotifications(userId: string, limit = 10) {
	return prisma.userNotification.findMany({
		where: { userId },
		orderBy: { createdAt: 'desc' },
		take: limit,
		select: {
			id: true,
			type: true,
			title: true,
			body: true,
			linkUrl: true,
			readAt: true,
			createdAt: true,
		},
	})
}

export async function markNotificationRead(
	notificationId: string,
	userId: string,
): Promise<boolean> {
	const result = await prisma.userNotification.updateMany({
		where: {
			id: notificationId,
			userId,
			readAt: null,
		},
		data: { readAt: new Date() },
	})

	return result.count > 0
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
	const result = await prisma.userNotification.updateMany({
		where: {
			userId,
			readAt: null,
		},
		data: { readAt: new Date() },
	})

	return result.count
}
