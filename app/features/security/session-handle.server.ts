import { createHmac } from "node:crypto";
import { getSessionSecret } from "#app/utils/env.server.ts";
import { prisma } from "#app/utils/db.server.ts";

/** Non-secret admin handle for revoking a session without exposing the cookie bearer. */
export function sessionAdminHandle(sessionId: string): string {
  const secret = getSessionSecret()[0];
  if (!secret) {
    throw new Error("SESSION_SECRET is required to derive session handles");
  }
  return createHmac("sha256", secret).update(sessionId).digest("hex").slice(0, 16);
}

export async function findSessionByAdminHandle(handle: string) {
  const sessions = await prisma.session.findMany({
    where: { expirationDate: { gt: new Date() } },
    select: { id: true, userId: true },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });
  for (const session of sessions) {
    if (sessionAdminHandle(session.id) === handle) return session;
  }
  return null;
}
