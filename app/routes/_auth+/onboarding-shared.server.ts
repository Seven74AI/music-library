import { redirect } from "react-router";
import { safeRedirect } from "remix-utils/safe-redirect";
import { checkIsCommonPassword, requireAnonymous, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { redirectWithToast } from "#app/utils/toast.server.ts";
import { verifySessionStorage } from "#app/utils/verification.server.ts";
import { onboardingEmailSessionKey } from "./onboarding-shared.ts";

/**
 * Shared gating for both onboarding routes: reject authenticated users, then
 * require a verified signup email in the verification session. Returns the
 * email and the verification session so callers (e.g. the OAuth route) can
 * read further session values without a second lookup.
 */
export async function requireOnboardingEmail(request: Request) {
  await requireAnonymous(request);
  const verifySession = await verifySessionStorage.getSession(
    request.headers.get("cookie"),
  );
  const email = verifySession.get(onboardingEmailSessionKey);
  if (typeof email !== "string" || !email) {
    throw redirect("/signup");
  }
  return { email, verifySession };
}

/**
 * Shared username-uniqueness check used by both onboarding superRefine
 * callbacks. Callers add the field issue against their own `ctx`.
 */
export async function usernameExists(username: string) {
  const existingUser = await prisma.user.findUnique({
    where: { username },
    select: { id: true },
  });
  return existingUser !== null;
}

/** Shared password-strength check for the email/password flow. */
export async function passwordIsCommon(password: string) {
  return checkIsCommonPassword(password);
}

/**
 * Shared post-signup tail: persist the auth session, clear the verification
 * session, and redirect home with a welcome toast.
 */
export async function commitOnboardingSession({
  session,
  remember,
  redirectTo,
  request,
}: {
  session: { id: string; expirationDate: Date };
  remember?: boolean;
  redirectTo?: string;
  request: Request;
}) {
  const authSession = await authSessionStorage.getSession(
    request.headers.get("cookie"),
  );
  authSession.set(sessionKey, session.id);
  const verifySession = await verifySessionStorage.getSession();
  const headers = new Headers();
  headers.append(
    "set-cookie",
    await authSessionStorage.commitSession(authSession, {
      expires: remember ? session.expirationDate : undefined,
    }),
  );
  headers.append("set-cookie", await verifySessionStorage.destroySession(verifySession));

  return redirectWithToast(
    safeRedirect(redirectTo),
    { title: "Welcome", description: "Thanks for signing up!", type: "success" },
    { headers },
  );
}
