import { parseString } from "set-cookie-parser";
import { data, redirect } from "react-router";
import { authSessionStorage } from "#app/utils/session.server.ts";
import {
  VerificationTypeSchema,
  codeQueryParam,
  redirectToQueryParam,
  targetQueryParam,
  typeQueryParam,
  type VerificationTypes,
} from "./verify.tsx";

export const pendingVerificationSessionKey = "pendingVerification";

export type PendingVerification = {
  code: string;
  type: VerificationTypes;
  target: string;
  redirectTo?: string;
};

export type VerifyLoaderData =
  | {
      hasPendingVerification: false;
      type: null;
    }
  | {
      hasPendingVerification: true;
      type: VerificationTypes;
      redirectTo?: string;
    };

export function getPendingVerification(
  session: Awaited<ReturnType<typeof authSessionStorage.getSession>>,
): PendingVerification | null {
  const raw = session.get(pendingVerificationSessionKey);
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Record<string, unknown>;
  const typeResult = VerificationTypeSchema.safeParse(candidate[typeQueryParam]);
  if (!typeResult.success) return null;
  const code = candidate[codeQueryParam];
  const target = candidate[targetQueryParam];
  if (typeof code !== "string" || typeof target !== "string") return null;
  const redirectTo = candidate[redirectToQueryParam];
  return {
    code,
    type: typeResult.data,
    target,
    redirectTo: typeof redirectTo === "string" ? redirectTo : undefined,
  };
}

export function setPendingVerification(
  session: Awaited<ReturnType<typeof authSessionStorage.getSession>>,
  pending: PendingVerification,
): void {
  session.set(pendingVerificationSessionKey, pending);
}

export function clearPendingVerification(
  session: Awaited<ReturnType<typeof authSessionStorage.getSession>>,
): void {
  session.unset(pendingVerificationSessionKey);
}

export function mergePendingVerificationIntoFormData(
  formData: FormData,
  pending: PendingVerification,
): void {
  formData.set(typeQueryParam, pending.type);
  formData.set(targetQueryParam, pending.target);
  if (pending.redirectTo) {
    formData.set(redirectToQueryParam, pending.redirectTo);
  }
}

function getSetCookieList(headers: Headers): string[] {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const single = headers.get("Set-Cookie");
  return single ? [single] : [];
}

/**
 * Clear pending verification on the auth session without clobbering a fresher
 * `en_session` Set-Cookie from the verify handler (e.g. 2FA session promotion).
 */
export async function mergeVerifyActionRedirectCookies(
  request: Request,
  verificationResponse: Response,
): Promise<Headers> {
  const headers = new Headers();
  for (const [key, value] of verificationResponse.headers.entries()) {
    if (key.toLowerCase() !== "set-cookie") {
      headers.append(key, value);
    }
  }
  const setCookies = getSetCookieList(verificationResponse.headers);
  for (const cookie of setCookies) {
    if (parseString(cookie)?.name !== "en_session") {
      headers.append("Set-Cookie", cookie);
    }
  }

  const sessionCookie = setCookies.find((cookie) => parseString(cookie)?.name === "en_session");
  const authSession = sessionCookie
    ? await authSessionStorage.getSession(sessionCookie)
    : await authSessionStorage.getSession(request.headers.get("cookie"));

  clearPendingVerification(authSession);
  headers.append("Set-Cookie", await authSessionStorage.commitSession(authSession));

  return headers;
}

function toPublicVerifyLoaderData(pending: PendingVerification | null): VerifyLoaderData {
  if (!pending) {
    return { hasPendingVerification: false, type: null };
  }
  return {
    hasPendingVerification: true,
    type: pending.type,
    redirectTo: pending.redirectTo,
  };
}

export async function handleVerifyLoader(request: Request) {
  const url = new URL(request.url);
  const session = await authSessionStorage.getSession(request.headers.get("cookie"));

  let commitSession = false;

  if (url.searchParams.has(codeQueryParam)) {
    const typeResult = VerificationTypeSchema.safeParse(url.searchParams.get(typeQueryParam));
    const target = url.searchParams.get(targetQueryParam);
    const code = url.searchParams.get(codeQueryParam);
    if (typeResult.success && target && code) {
      const redirectTo = url.searchParams.get(redirectToQueryParam) ?? undefined;
      setPendingVerification(session, {
        code,
        type: typeResult.data,
        target,
        redirectTo,
      });
      commitSession = true;
    }
    throw redirect("/verify", {
      headers: commitSession
        ? {
            "Set-Cookie": await authSessionStorage.commitSession(session),
          }
        : undefined,
    });
  }

  // Signup / forgot-password send users here with type+target only — drop stale OTP-in-URL session.
  if (url.searchParams.has(typeQueryParam) && session.has(pendingVerificationSessionKey)) {
    clearPendingVerification(session);
    commitSession = true;
  }

  const loaderBody = toPublicVerifyLoaderData(getPendingVerification(session));

  if (commitSession) {
    return data(loaderBody, {
      headers: {
        "Set-Cookie": await authSessionStorage.commitSession(session),
      },
    });
  }

  return data(loaderBody);
}
