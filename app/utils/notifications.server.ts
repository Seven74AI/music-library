import { prisma } from "#app/utils/db.server.ts";

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  return prisma.userNotification.count({
    where: {
      userId,
      readAt: null,
    },
  });
}

export async function getRecentNotifications(userId: string, limit = 10) {
  return prisma.userNotification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
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
  });
}

/**
 * Marks a single notification as read.
 *
 * Concurrency safety: the `readAt: null` guard in the `where` clause makes
 * this operation idempotent. If two concurrent calls target the same
 * notification, only the first one matches (readAt is still null); the
 * second call sees readAt already set and matches zero rows, returning
 * false. No double-update is possible.
 */
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
  });

  return result.count > 0;
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  // Snapshot current unread IDs first to avoid a race condition: if a new
  // notification arrives between the findMany and updateMany, it is excluded
  // from the update and remains unread (the user sees it).
  const unreadIds = await prisma.userNotification.findMany({
    where: { userId, readAt: null },
    select: { id: true },
  });

  if (unreadIds.length === 0) return 0;

  const result = await prisma.userNotification.updateMany({
    where: {
      id: { in: unreadIds.map((n) => n.id) },
    },
    data: { readAt: new Date() },
  });

  return result.count;
}
