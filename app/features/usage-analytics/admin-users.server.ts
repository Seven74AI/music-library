import {
  recordSecurityEvent,
  SECURITY_EVENT_TYPES,
} from "#app/features/security/track-event.server.ts";
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
    select: { id: true, username: true, roles: { select: { name: true } } },
  });
}

async function recordModeration(
  eventType: string,
  target: { id: string; username: string },
  actorUserId: string | null | undefined,
  metadata: Record<string, string | number | boolean | null> = {},
) {
  await recordSecurityEvent({
    eventType,
    userId: actorUserId ?? null,
    targetUserId: target.id,
    metadata: { username: target.username, ...metadata },
  });
}

function countAdmins() {
  return prisma.user.count({ where: { roles: { some: { name: "admin" } } } });
}

export async function disableUser(
  userId: string,
  actorUserId?: string | null,
): Promise<ModerationResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true },
  });
  if (!user) return notFound;

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { disabledAt: new Date() },
    }),
    prisma.session.deleteMany({ where: { userId } }),
  ]);
  await recordModeration(SECURITY_EVENT_TYPES.accountDisabled, user, actorUserId, {
    action: "disable",
  });
  return { ok: true };
}

export async function enableUser(
  userId: string,
  actorUserId?: string | null,
): Promise<ModerationResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true },
  });
  if (!user) return notFound;

  await prisma.user.update({
    where: { id: userId },
    data: { disabledAt: null },
  });
  await recordModeration(SECURITY_EVENT_TYPES.accountEnabled, user, actorUserId, {
    action: "enable",
  });
  return { ok: true };
}

export async function promoteToAdmin(
  userId: string,
  actorUserId?: string | null,
): Promise<ModerationResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true },
  });
  if (!user) return notFound;

  await prisma.user.update({
    where: { id: userId },
    data: {
      roles: {
        connect: { name: "admin" },
      },
    },
  });
  await recordModeration(SECURITY_EVENT_TYPES.roleChanged, user, actorUserId, {
    role: "admin",
    action: "promote",
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
  await recordModeration(SECURITY_EVENT_TYPES.roleChanged, target, actorUserId, {
    role: "admin",
    action: "demote",
  });
  return { ok: true };
}

const CURATOR_PERMISSIONS = [
  {
    action: "update",
    entity: "metadata",
    access: "any",
    description: "Update any track/artist/album metadata",
  },
  {
    action: "read",
    entity: "metadata-history",
    access: "any",
    description: "Read any metadata edit history",
  },
  {
    action: "restore",
    entity: "metadata",
    access: "any",
    description: "Restore metadata from history",
  },
  {
    action: "update",
    entity: "artist",
    access: "any",
    description: "Update any artist",
  },
  {
    action: "merge",
    entity: "artist",
    access: "any",
    description: "Merge duplicate artists",
  },
  {
    action: "update",
    entity: "album",
    access: "any",
    description: "Update any album",
  },
  {
    action: "merge",
    entity: "album",
    access: "any",
    description: "Merge duplicate albums",
  },
] as const;

/**
 * Production databases that applied schema migrations without the curator seed
 * row throw P2025 on `connect: { name: "curator" }`. Create the role (and its
 * permissions) before connecting so promotion cannot 500.
 */
async function ensureCuratorRole() {
  const permissions = [];
  for (const permission of CURATOR_PERMISSIONS) {
    const row = await prisma.permission.upsert({
      where: {
        action_entity_access: {
          action: permission.action,
          entity: permission.entity,
          access: permission.access,
        },
      },
      update: {},
      create: permission,
    });
    permissions.push({ id: row.id });
  }

  await prisma.role.upsert({
    where: { name: "curator" },
    update: {
      permissions: { connect: permissions },
    },
    create: {
      name: "curator",
      description: "Can edit and manage metadata for tracks, artists, and albums",
      permissions: { connect: permissions },
    },
  });
}

export async function promoteToCurator(
  userId: string,
  actorUserId?: string | null,
): Promise<ModerationResult> {
  if (actorUserId && userId === actorUserId) {
    return forbidden("You cannot promote yourself to curator");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true },
  });
  if (!user) return notFound;

  await ensureCuratorRole();

  await prisma.user.update({
    where: { id: userId },
    data: {
      roles: {
        connect: { name: "curator" },
      },
    },
  });
  await recordModeration(SECURITY_EVENT_TYPES.roleChanged, user, actorUserId, {
    role: "curator",
    action: "promote",
  });
  return { ok: true };
}

export async function demoteFromCurator(
  userId: string,
  actorUserId?: string | null,
): Promise<ModerationResult> {
  if (actorUserId && userId === actorUserId) {
    return forbidden("You cannot demote yourself from curator");
  }

  const user = await findUserRoles(userId);
  if (!user) return notFound;

  if (!user.roles.some((role) => role.name === "curator")) {
    return forbidden("This user is not a curator");
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      roles: {
        disconnect: { name: "curator" },
      },
    },
  });
  await recordModeration(SECURITY_EVENT_TYPES.roleChanged, user, actorUserId, {
    role: "curator",
    action: "demote",
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

  await recordModeration(SECURITY_EVENT_TYPES.accountDeleted, target, actorUserId, {
    action: "delete",
  });
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
