import { data } from "react-router";
import { type z } from "zod";
import { handleVerification as handleChangeEmailVerification } from "#app/routes/settings+/profile.change-email.server.tsx";
import { getUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { handleVerification as handleLoginTwoFactorVerification } from "./login.server.ts";
import { handleVerification as handleOnboardingVerification } from "./onboarding.server.ts";
import { handleVerification as handleResetPasswordVerification } from "./reset-password.server.ts";
import {
  targetQueryParam,
  typeQueryParam,
  VerifySchema,
  type VerifyFunctionArgs,
} from "./verify.shared.ts";

export async function dispatchVerification(
  submissionValue: z.output<typeof VerifySchema>,
  args: VerifyFunctionArgs & {
    submission: Extract<VerifyFunctionArgs["submission"], { status: "success" }>;
    deleteVerification: () => Promise<void>;
  },
) {
  const { request, body, submission, deleteVerification } = args;

  switch (submissionValue[typeQueryParam]) {
    case "reset-password": {
      return handleResetPasswordVerification({ request, body, submission });
    }
    case "onboarding": {
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
