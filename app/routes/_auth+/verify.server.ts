import { type Submission } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import { data } from "react-router";
import { z } from "zod";
import { handleVerification as handleChangeEmailVerification } from "#app/routes/settings+/profile.change-email.server.tsx";
import { twoFAVerificationType } from "#app/routes/settings+/profile.two-factor.tsx";
import { getUserId, requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { getDomainUrl } from "#app/utils/misc.tsx";
import { redirectWithToast } from "#app/utils/toast.server.ts";
import {
  decryptVerificationSecret,
  encryptVerificationSecret,
} from "#app/utils/token-cipher.server.ts";
import { generateTOTP, verifyTOTP } from "#app/utils/totp.server.ts";
import { type twoFAVerifyVerificationType } from "../settings+/profile.two-factor.verify.tsx";
import {
  handleVerification as handleLoginTwoFactorVerification,
  shouldRequestTwoFA,
} from "./login.server.ts";
import { handleVerification as handleOnboardingVerification } from "./onboarding.server.ts";
import { handleVerification as handleResetPasswordVerification } from "./reset-password.server.ts";
import {
  VerifySchema,
  codeQueryParam,
  redirectToQueryParam,
  targetQueryParam,
  typeQueryParam,
  type VerificationTypes,
} from "./verify.tsx";

export type VerifyFunctionArgs = {
  request: Request;
  submission: Submission<z.input<typeof VerifySchema>, string[], z.output<typeof VerifySchema>>;
  body: FormData | URLSearchParams;
  /** Set for change-email verifications after loading from the Verification row. */
  pendingNewEmail?: string;
};

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
    // Leaving off 0, O, and I on purpose to avoid confusing users.
    charSet: "ABCDEFGHJKLMNPQRSTUVWXYZ123456789",
    period,
  });
  const verificationData = {
    type,
    target,
    ...verificationConfig,
    // Store the TOTP secret encrypted at rest (AES-256-GCM, `enc1:` prefix).
    secret: encryptVerificationSecret(verificationConfig.secret),
    expiresAt: new Date(Date.now() + verificationConfig.period * 1000),
    linkConsumedAt: null,
    ...(pendingEmail !== undefined ? { pendingEmail } : {}),
  };
  await prisma.verification.upsert({
    where: { target_type: { target, type } },
    create: verificationData,
    update: verificationData,
  });

  // add the otp to the url we'll email the user.
  verifyUrl.searchParams.set(codeQueryParam, otp);

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
    select: {
      algorithm: true,
      secret: true,
      period: true,
      charSet: true,
      linkConsumedAt: true,
    },
  });
  if (!verification) return false;
  if (verification.linkConsumedAt) return false;
  const result = await verifyTOTP({
    otp: code,
    ...verification,
    secret: decryptVerificationSecret(verification.secret),
  });
  if (!result) return false;

  return true;
}

/** True when the user already exchanged the emailed link OTP on GET (session-backed POST). */
export async function isLinkConsumedVerificationValid({
  type,
  target,
}: {
  type: VerificationTypes | typeof twoFAVerifyVerificationType;
  target: string;
}) {
  const verification = await prisma.verification.findFirst({
    where: {
      target,
      type,
      linkConsumedAt: { not: null },
      OR: [{ expiresAt: { gt: new Date() } }, { expiresAt: null }],
    },
    select: { id: true },
  });
  return Boolean(verification);
}

/**
 * Validate an emailed magic-link OTP on GET, mark it consumed, and return whether
 * the exchange succeeded.
 */
export async function consumeVerificationLink({
  code,
  type,
  target,
}: {
  code: string;
  type: VerificationTypes;
  target: string;
}): Promise<{ ok: true } | { ok: false }> {
  const valid = await isCodeValid({ code, type, target });
  if (!valid) {
    return { ok: false };
  }
  const consumed = await prisma.verification.updateMany({
    where: {
      target,
      type,
      linkConsumedAt: null,
    },
    data: { linkConsumedAt: new Date() },
  });
  if (consumed.count !== 1) {
    return { ok: false };
  }
  return { ok: true };
}

export async function validateRequest(
  request: Request,
  body: URLSearchParams | FormData,
  options?: { sessionBacked?: boolean },
) {
  const submission = await parseWithZod(body, {
    schema: VerifySchema.superRefine(async (formValues, ctx) => {
      const code = formValues[codeQueryParam];
      const type = formValues[typeQueryParam];
      const target = formValues[targetQueryParam];

      const codeIsValid = options?.sessionBacked
        ? await isLinkConsumedVerificationValid({ type, target })
        : await isCodeValid({ code, type, target });
      if (!codeIsValid) {
        ctx.addIssue({
          path: ["code"],
          code: z.ZodIssueCode.custom,
          message: `Invalid code`,
        });
        return;
      }
    }),
    async: true,
  });

  if (submission.status !== "success") {
    return data(
      { result: submission.reply() },
      { status: submission.status === "error" ? 400 : 200 },
    );
  }

  const { value: submissionValue } = submission;

  async function deleteVerification() {
    await prisma.verification.delete({
      where: {
        target_type: {
          type: submissionValue[typeQueryParam],
          target: submissionValue[targetQueryParam],
        },
      },
    });
  }

  switch (submissionValue[typeQueryParam]) {
    case "reset-password": {
      await deleteVerification();
      return handleResetPasswordVerification({ request, body, submission });
    }
    case "onboarding": {
      await deleteVerification();
      return handleOnboardingVerification({ request, body, submission });
    }
    case "change-email": {
      const sessionUserId = await getUserId(request);
      if (!sessionUserId || sessionUserId !== submissionValue[targetQueryParam]) {
        return data(
          {
            result: submission.reply({
              formErrors: ["You can only complete an email change for your own account."],
            }),
          },
          { status: 403 },
        );
      }

      const pendingVerification = await prisma.verification.findUnique({
        where: {
          target_type: {
            type: submissionValue[typeQueryParam],
            target: submissionValue[targetQueryParam],
          },
        },
        select: { pendingEmail: true },
      });
      const pendingNewEmail = pendingVerification?.pendingEmail;
      if (!pendingNewEmail) {
        return data(
          {
            result: submission.reply({
              formErrors: ["This email change request is no longer valid. Please start again."],
            }),
          },
          { status: 400 },
        );
      }

      await deleteVerification();
      return handleChangeEmailVerification({ request, body, submission, pendingNewEmail });
    }
    case "2fa": {
      return handleLoginTwoFactorVerification({ request, body, submission });
    }
  }
}
