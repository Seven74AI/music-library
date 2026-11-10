import { twoFAVerificationType } from "#app/routes/settings+/profile.two-factor.tsx";
import { getUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { verifySessionStorage } from "#app/utils/verification.server.ts";
import { unverifiedSessionIdKey, verifiedTimeKey } from "./login.session-keys.server.ts";

export async function shouldRequestTwoFA(request: Request) {
  const authSession = await authSessionStorage.getSession(request.headers.get("cookie"));
  const verifySession = await verifySessionStorage.getSession(request.headers.get("cookie"));
  if (verifySession.has(unverifiedSessionIdKey)) return true;
  const userId = await getUserId(request);
  if (!userId) return false;
  const userHasTwoFA = await prisma.verification.findUnique({
    select: { id: true },
    where: { target_type: { target: userId, type: twoFAVerificationType } },
  });
  if (!userHasTwoFA) return false;
  const verifiedTime = authSession.get(verifiedTimeKey) ?? new Date(0);
  const twoHours = 1000 * 60 * 60 * 2;
  return Date.now() - verifiedTime > twoHours;
}
