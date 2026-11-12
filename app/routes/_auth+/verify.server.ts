import { parseWithZod } from "@conform-to/zod/v4";
import { data } from "react-router";
import { z } from "zod";
import { prisma } from "#app/utils/db.server.ts";
import { dispatchVerification } from "./verify-dispatch.server.ts";
import { isCodeValid } from "./verify-guards.server.ts";
import {
  codeQueryParam,
  targetQueryParam,
  typeQueryParam,
  VerifySchema,
  type VerifyFunctionArgs,
} from "./verify.shared.ts";

export type { VerifyFunctionArgs } from "./verify.shared.ts";
export {
  getRedirectToUrl,
  isCodeValid,
  prepareVerification,
  requireRecentVerification,
} from "./verify-guards.server.ts";

export async function validateRequest(request: Request, body: URLSearchParams | FormData) {
  const submission = await parseWithZod(body, {
    schema: VerifySchema.superRefine(async (formValues, ctx) => {
      const codeIsValid = await isCodeValid({
        code: formValues[codeQueryParam],
        type: formValues[typeQueryParam],
        target: formValues[targetQueryParam],
      });
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

  if (
    submissionValue[typeQueryParam] === "reset-password" ||
    submissionValue[typeQueryParam] === "onboarding"
  ) {
    await deleteVerification();
  }

  return dispatchVerification(submissionValue, { request, body, submission, deleteVerification });
}
