import { prisma } from "#app/utils/db.server.ts";
import {
  metaString,
  parseSecurityMetadata,
  recordSecurityEvent,
  SECURITY_EVENT_TYPES,
} from "./track-event.server.ts";

/**
 * Defense-in-depth authorization guard for session revocation. A caller may
 * revoke a session when they own it (self-logout) or hold the `admin` role.
 * The admin+ route already enforces `requireUserWithRole("admin")`, so this is
 * a second gate against a future caller wiring these helpers without that check.
 */
async function actorCanRevokeSession(actorUserId: string, ownerUserId: string): Promise<boolean> {
  if (actorUserId === ownerUserId) return true;
  const admin = await prisma.user.findFirst({
    select: { id: true },
    where: { id: actorUserId, roles: { some: { name: "admin" } } },
  });
  return admin !== null;
}

export async function listActiveSessions(now = new Date()) {
  const sessions = await prisma.session.findMany({
    where: { expirationDate: { gt: now } },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      id: true,
      userId: true,
      createdAt: true,
      updatedAt: true,
      expirationDate: true,
      user: { select: { username: true } },
    },
  });

  const ids = new Set(sessions.map((session) => session.id));
  const context = new Map<string, { ipHash: string | null; device: string | null }>();
  if (ids.size > 0) {
    const events = await prisma.securityEvent.findMany({
      where: {
        eventType: SECURITY_EVENT_TYPES.loginSuccess,
        createdAt: { gte: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
      select: { ipHash: true, metadata: true },
    });
    for (const event of events) {
      const sessionId = metaString(parseSecurityMetadata(event.metadata), "sessionId");
      if (!sessionId || !ids.has(sessionId) || context.has(sessionId)) continue;
      context.set(sessionId, {
        ipHash: event.ipHash,
        device: metaString(parseSecurityMetadata(event.metadata), "device"),
      });
    }
  }

  return sessions.map((session) => ({
    id: session.id,
    userId: session.userId,
    username: session.user.username,
    ipHash: context.get(session.id)?.ipHash ?? null,
    device: context.get(session.id)?.device ?? null,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    expirationDate: session.expirationDate.toISOString(),
  }));
}

export async function forceLogoutSession({
  sessionId,
  actorUserId,
  request,
}: {
  sessionId: string;
  actorUserId: string;
  request?: Request;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, userId: true },
  });
  if (!session) return { ok: false, error: "Session not found" };

  if (!(await actorCanRevokeSession(actorUserId, session.userId))) {
    return { ok: false, error: "Not authorized" };
  }

  await prisma.session.delete({ where: { id: sessionId } });
  await recordSecurityEvent({
    request,
    eventType: SECURITY_EVENT_TYPES.sessionRevoked,
    userId: actorUserId,
    targetUserId: session.userId,
    perpetual: false,
    metadata: { sessionId, scope: "one" },
  });
  return { ok: true };
}

export async function forceLogoutUserSessions({
  userId,
  actorUserId,
  request,
}: {
  userId: string;
  actorUserId: string;
  request?: Request;
}): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true },
  });
  if (!user) return { ok: false, error: "User not found" };

  if (!(await actorCanRevokeSession(actorUserId, user.id))) {
    return { ok: false, error: "Not authorized" };
  }

  const result = await prisma.session.deleteMany({ where: { userId } });
  await recordSecurityEvent({
    request,
    eventType: SECURITY_EVENT_TYPES.sessionRevoked,
    userId: actorUserId,
    targetUserId: userId,
    perpetual: false,
    metadata: { scope: "all", count: result.count, username: user.username },
  });
  return { ok: true, count: result.count };
}
