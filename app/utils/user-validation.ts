import { z } from "zod";

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;

export const UsernameSchema = z
  .string({ error: "Username is required" })
  .min(USERNAME_MIN_LENGTH, { message: "Username is too short" })
  .max(USERNAME_MAX_LENGTH, { message: "Username is too long" })
  .regex(/^[a-zA-Z0-9_]+$/, {
    message: "Username can only include letters, numbers, and underscores",
  })
  // users can type the username in any case, but we store it in lowercase
  .transform((value) => value.toLowerCase());

export const PASSWORD_MIN_LENGTH = 12;
// bcrypt only uses the first 72 bytes.
// https://github.com/epicweb-dev/epic-stack/issues/918
export const PASSWORD_MAX_BYTES = 72;

const passwordWithinBcryptLimit = (password: string) =>
  new TextEncoder().encode(password).length <= PASSWORD_MAX_BYTES;

export const PasswordSchema = z
  .string({ error: "Password is required" })
  .min(PASSWORD_MIN_LENGTH, { message: "Password is too short" })
  .refine(passwordWithinBcryptLimit, { message: "Password is too long" });

// Checked against a stored hash. Accounts created under the previous minimum
// can still sign in and confirm that password; new passwords use PasswordSchema.
export const ExistingPasswordSchema = z
  .string({ error: "Password is required" })
  .min(1, { message: "Password is required" })
  .refine(passwordWithinBcryptLimit, { message: "Password is too long" });

export const NameSchema = z
  .string({ error: "Name is required" })
  .min(3, { message: "Name is too short" })
  .max(40, { message: "Name is too long" });

export const EmailSchema = z
  .string({ error: "Email is required" })
  .email({ message: "Email is invalid" })
  .min(3, { message: "Email is too short" })
  .max(100, { message: "Email is too long" })
  // users can type the email in any case, but we store it in lowercase
  .transform((value) => value.toLowerCase());

export const PasswordAndConfirmPasswordSchema = z
  .object({ password: PasswordSchema, confirmPassword: PasswordSchema })
  .superRefine(({ confirmPassword, password }, ctx) => {
    if (confirmPassword !== password) {
      ctx.addIssue({
        path: ["confirmPassword"],
        code: "custom",
        message: "The passwords must match",
      });
    }
  });
