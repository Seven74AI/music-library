import { type Submission } from "@conform-to/react";
import { z } from "zod";

export const codeQueryParam = "code";
export const targetQueryParam = "target";
export const typeQueryParam = "type";
export const redirectToQueryParam = "redirectTo";

const verificationTypes = ["onboarding", "reset-password", "change-email", "2fa"] as const;
export const VerificationTypeSchema = z.enum(verificationTypes);
export type VerificationTypes = z.infer<typeof VerificationTypeSchema>;

export const VerifySchema = z.object({
  [codeQueryParam]: z.string().min(6).max(6),
  [typeQueryParam]: VerificationTypeSchema,
  [targetQueryParam]: z.string(),
  [redirectToQueryParam]: z.string().optional(),
});

export type VerifyFunctionArgs = {
  request: Request;
  submission: Submission<z.input<typeof VerifySchema>, string[], z.output<typeof VerifySchema>>;
  body: FormData | URLSearchParams;
  /** Set for change-email verifications after loading from the Verification row. */
  pendingNewEmail?: string;
};
