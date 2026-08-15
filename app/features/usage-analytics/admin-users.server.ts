import { prisma } from "#app/utils/db.server.ts";
import { getUtcDayStart } from "./record-usage.server.ts";

export { getUtcDayStart };

/**
 * `reason` lets routes pick a status code without string-matching the message.
 */
export type ModerationResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "forbidden"; error: string };

const notFound: ModerationResult = {
  ok: false,
  reason: "not-found",
  error: "User not found",
};

function forbidden(error: string): ModerationResult {
  return { ok: false, reason: "forbidden", error };
}

async function findUserRoles(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, roles: { select: { name: true } } },
  });
}

function countAdmins() {
  return prisma.user.count({ where: { roles: { some: { name: "admin" } } } });
}

export async function disableUser(userId: string): Promise<ModerationResult> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return notFound;

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { disabledAt: new Date() },
    }),
    prisma.session.deleteMany({ where: { userId } }),
  ]);
  return { ok: true };
}

export async function enableUser(userId: string): Promise<ModerationResult> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return notFound;

  await prisma.user.update({
    where: { id: userId },
    data: { disabledAt: null },
  });
  return { ok: true };
}

export async function promoteToAdmin(userId: string): Promise<ModerationResult> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return notFound;

  await prisma.user.update({
    where: { id: userId },
    data: {
      roles: {
        connect: { name: "admin" },
      },
    },
  });
  return { ok: true };
}

export async function demoteFromAdmin({
  targetUserId,
  actorUserId,
}: {
  targetUserId: string;
  actorUserId: string;
}): Promise<ModerationResult> {
  if (targetUserId === actorUserId) {
    return forbidden("You cannot demote yourself");
  }

  const target = await findUserRoles(targetUserId);
  if (!target) return notFound;

  // Checked before counting admins, otherwise demoting a non-admin while a
  // single admin exists reports the misleading "last admin" error.
  if (!target.roles.some((role) => role.name === "admin")) {
    return forbidden("This user is not an admin");
  }

  if ((await countAdmins()) <= 1) {
    return forbidden("Cannot demote the last admin");
  }

  await prisma.user.update({
    where: { id: targetUserId },
    data: {
      roles: {
        disconnect: { name: "admin" },
      },
    },
  });
  return { ok: true };
}

export async function deleteUserAsAdmin({
  targetUserId,
  actorUserId,
}: {
  targetUserId: string;
  actorUserId: string;
}): Promise<ModerationResult> {
  if (targetUserId === actorUserId) {
    return forbidden("You cannot delete your own account from admin");
  }

  const target = await findUserRoles(targetUserId);
  if (!target) return notFound;

  const isAdmin = target.roles.some((role) => role.name === "admin");
  if (isAdmin && (await countAdmins()) <= 1) {
    return forbidden("Cannot delete the last admin");
  }

  await prisma.user.delete({ where: { id: targetUserId } });
  return { ok: true };
}

/** Last N UTC days inclusive of today, oldest first. */
export function buildDayRange(days: number, end: Date = new Date()): Date[] {
  const endDay = getUtcDayStart(end);
  const result: Date[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date(endDay);
    day.setUTCDate(day.getUTCDate() - i);
    result.push(day);
  }
  return result;
}
