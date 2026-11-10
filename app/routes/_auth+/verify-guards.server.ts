import { twoFAVerificationType } from "#app/routes/settings+/profile.two-factor.tsx";
import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { getDomainUrl } from "#app/utils/misc.tsx";
import { redirectWithToast } from "#app/utils/toast.server.ts";
import {
  decryptVerificationSecret,
  encryptVerificationSecret,
} from "#app/utils/token-cipher.server.ts";
import { generateTOTP, verifyTOTP } from "#app/utils/totp.server.ts";
import { twoFAVerifyVerificationType } from "../settings+/profile.two-factor.tsx";
import { shouldRequestTwoFA } from "./login-two-factor.server.ts";
import {
  redirectToQueryParam,
  targetQueryParam,
  typeQueryParam,
  type VerificationTypes,
} from "./verify.shared.ts";

export function getRedirectToUrl({
  request,
  type,
  target,
  redirectTo,
}: {
  request: Request;
  type: VerificationTypes;
  target: string;
  redirectTo?: string;
}) {
  const redirectToUrl = new URL(`${getDomainUrl(request)}/verify`);
  redirectToUrl.searchParams.set(typeQueryParam, type);
  redirectToUrl.searchParams.set(targetQueryParam, target);
  if (redirectTo) {
    redirectToUrl.searchParams.set(redirectToQueryParam, redirectTo);
  }
  return redirectToUrl;
}

export async function requireRecentVerification(request: Request, url?: URL) {
  const userId = await requireUserId(request);
  const shouldReverify = await shouldRequestTwoFA(request);
  if (shouldReverify) {
    const reqUrl = url ?? new URL(request.url);
    const redirectUrl = getRedirectToUrl({
      request,
      target: userId,
      type: twoFAVerificationType,
      redirectTo: reqUrl.pathname + reqUrl.search,
    });
    throw await redirectWithToast(redirectUrl.toString(), {
      title: "Please Reverify",
      description: "Please reverify your account before proceeding",
      type: "message",
    });
  }
}

export async function prepareVerification({
  period,
  request,
  type,
  target,
  pendingEmail,
}: {
  period: number;
  request: Request;
  type: VerificationTypes;
  target: string;
  pendingEmail?: string;
}) {
  const verifyUrl = getRedirectToUrl({ request, type, target });
  const redirectTo = new URL(verifyUrl.toString());

  const { otp, ...verificationConfig } = await generateTOTP({
    algorithm: "SHA-256",
    charSet: "ABCDEFGHJKLMNPQRSTUVWXYZ123456789",
    period,
  });
  const verificationData = {
    type,
    target,
    ...verificationConfig,
    secret: encryptVerificationSecret(verificationConfig.secret),
    expiresAt: new Date(Date.now() + verificationConfig.period * 1000),
    ...(pendingEmail !== undefined ? { pendingEmail } : {}),
  };
  await prisma.verification.upsert({
    where: { target_type: { target, type } },
    create: verificationData,
    update: verificationData,
  });

  return { otp, redirectTo, verifyUrl };
}

export async function isCodeValid({
  code,
  type,
  target,
}: {
  code: string;
  type: VerificationTypes | typeof twoFAVerifyVerificationType;
  target: string;
}) {
  const verification = await prisma.verification.findUnique({
    where: {
      target_type: { target, type },
      OR: [{ expiresAt: { gt: new Date() } }, { expiresAt: null }],
    },
    select: { algorithm: true, secret: true, period: true, charSet: true },
  });
  if (!verification) return false;
  const result = await verifyTOTP({
    otp: code,
    ...verification,
    secret: decryptVerificationSecret(verification.secret),
  });
  if (!result) return false;

  return true;
}
