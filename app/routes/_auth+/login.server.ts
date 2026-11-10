import { invariant } from "@epic-web/invariant";
import { redirect } from "react-router";
import { safeRedirect } from "remix-utils/safe-redirect";
import { twoFAVerificationType } from "#app/routes/settings+/profile.two-factor.tsx";
import { getUserId, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { combineResponseInits } from "#app/utils/misc.tsx";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { redirectWithToast } from "#app/utils/toast.server.ts";
import { verifySessionStorage } from "#app/utils/verification.server.ts";
import {
  rememberKey,
  unverifiedSessionIdKey,
  verifiedTimeKey,
} from "./login.session-keys.server.ts";
import { getRedirectToUrl } from "./verify-guards.server.ts";
import { type VerifyFunctionArgs } from "./verify.shared.ts";

export { shouldRequestTwoFA } from "./login-two-factor.server.ts";

export async function handleNewSession(
  {
    request,
    session,
    redirectTo,
    remember,
  }: {
    request: Request;
    session: { userId: string; id: string; expirationDate: Date };
    redirectTo?: string;
    remember: boolean;
  },
  responseInit?: ResponseInit,
) {
  const verification = await prisma.verification.findUnique({
    select: { id: true },
    where: {
      target_type: { target: session.userId, type: twoFAVerificationType },
    },
  });
  const userHasTwoFactor = Boolean(verification);

  if (userHasTwoFactor) {
    const verifySession = await verifySessionStorage.getSession();
    verifySession.set(unverifiedSessionIdKey, session.id);
    verifySession.set(rememberKey, remember);
    const redirectUrl = getRedirectToUrl({
      request,
      type: twoFAVerificationType,
      target: session.userId,
      redirectTo,
    });
    return redirect(
      `${redirectUrl.pathname}?${redirectUrl.searchParams}`,
      combineResponseInits(
        {
          headers: {
            "set-cookie": await verifySessionStorage.commitSession(verifySession),
          },
        },
        responseInit,
      ),
    );
  } else {
    const authSession = await authSessionStorage.getSession(request.headers.get("cookie"));
    authSession.set(sessionKey, session.id);

    return redirect(
      safeRedirect(redirectTo),
      combineResponseInits(
        {
          headers: {
            "set-cookie": await authSessionStorage.commitSession(authSession, {
              expires: remember ? session.expirationDate : undefined,
            }),
          },
        },
        responseInit,
      ),
    );
  }
}

export async function handleVerification({ request, submission }: VerifyFunctionArgs) {
  invariant(submission.status === "success", "Submission should be successful by now");
  const authSession = await authSessionStorage.getSession(request.headers.get("cookie"));
  const verifySession = await verifySessionStorage.getSession(request.headers.get("cookie"));

  const remember = verifySession.get(rememberKey);
  const { redirectTo } = submission.value;
  const headers = new Headers();
  authSession.set(verifiedTimeKey, Date.now());

  const unverifiedSessionId = verifySession.get(unverifiedSessionIdKey);
  if (unverifiedSessionId) {
    const session = await prisma.session.findUnique({
      select: { expirationDate: true, userId: true },
      where: { id: unverifiedSessionId },
    });
    if (!session) {
      throw await redirectWithToast("/login", {
        type: "error",
        title: "Invalid session",
        description: "Could not find session to verify. Please try again.",
      });
    }
    // isCodeValid checks the OTP against form `target`, a client-editable
    // hidden field. Bind it to the pending session so another account's
    // authenticator cannot complete this login.
    if (session.userId !== submission.value.target) {
      throw await redirectWithToast("/login", {
        type: "error",
        title: "Invalid verification",
        description: "Could not verify this session. Please try again.",
      });
    }
    authSession.set(sessionKey, unverifiedSessionId);

    headers.append(
      "set-cookie",
      await authSessionStorage.commitSession(authSession, {
        expires: remember ? session.expirationDate : undefined,
      }),
    );
  } else {
    // Reverify while already signed in: the OTP target must be this user.
    const userId = await getUserId(request);
    if (!userId || userId !== submission.value.target) {
      throw await redirectWithToast("/login", {
        type: "error",
        title: "Invalid verification",
        description: "Could not verify this session. Please try again.",
      });
    }
    headers.append("set-cookie", await authSessionStorage.commitSession(authSession));
  }

  headers.append("set-cookie", await verifySessionStorage.destroySession(verifySession));

  return redirect(safeRedirect(redirectTo), { headers });
}
