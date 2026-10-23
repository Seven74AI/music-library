import { z } from "zod";
import { NameSchema, UsernameSchema } from "#app/utils/user-validation.ts";

/**
 * Session key that carries the verified signup email into the onboarding
 * routes. Written by `onboarding.server.ts` (email flow) and
 * `auth.$provider.callback.ts` (OAuth flow).
 */
export const onboardingEmailSessionKey = "onboardingEmail";

/**
 * Schema fields shared by both onboarding flows (email/password and OAuth).
 * Each route extends this with its auth-mechanism-specific fields:
 * - email/password: `.and(PasswordAndConfirmPasswordSchema)`
 * - OAuth:          `.extend({ imageUrl: z.string().optional() })`
 */
export const SignupFormBaseSchema = z.object({
  username: UsernameSchema,
  name: NameSchema,
  agreeToTermsOfServiceAndPrivacyPolicy: z.boolean({
    error: "You must agree to the terms of service and privacy policy",
  }),
  remember: z.boolean().optional(),
  redirectTo: z.string().optional(),
});
