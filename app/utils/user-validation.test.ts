import { describe, expect, test } from "vitest";
import {
  ExistingPasswordSchema,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  PasswordAndConfirmPasswordSchema,
  PasswordSchema,
} from "./user-validation.ts";

const previousMinimum = "abcdef";
const elevenCharacters = "abcdefghijk";
const twelveCharacters = "abcdefghijkl";

describe("PasswordSchema", () => {
  test("requires at least 12 characters for a new password", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);

    for (const password of [previousMinimum, elevenCharacters]) {
      const result = PasswordSchema.safeParse(password);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.message === "Password is too short")).toBe(
          true,
        );
      }
    }

    expect(PasswordSchema.safeParse(twelveCharacters).success).toBe(true);
  });

  test("keeps the bcrypt 72-byte maximum", () => {
    expect(PASSWORD_MAX_BYTES).toBe(72);
    expect(PasswordSchema.safeParse("a".repeat(PASSWORD_MAX_BYTES)).success).toBe(true);

    const tooManyBytes = PasswordSchema.safeParse("a".repeat(PASSWORD_MAX_BYTES + 1));
    expect(tooManyBytes.success).toBe(false);
    if (!tooManyBytes.success) {
      expect(
        tooManyBytes.error.issues.some((issue) => issue.message === "Password is too long"),
      ).toBe(true);
    }

    // "é" is one character and two UTF-8 bytes, so the cap is not a character count.
    const seventyTwoBytes = "é".repeat(36);
    expect(new TextEncoder().encode(seventyTwoBytes).length).toBe(72);
    expect(PasswordSchema.safeParse(seventyTwoBytes).success).toBe(true);

    const overSeventyTwoBytes = "é".repeat(37);
    expect(new TextEncoder().encode(overSeventyTwoBytes).length).toBe(74);
    const multibyte = PasswordSchema.safeParse(overSeventyTwoBytes);
    expect(multibyte.success).toBe(false);
    if (!multibyte.success) {
      expect(multibyte.error.issues.some((issue) => issue.message === "Password is too long")).toBe(
        true,
      );
    }
  });
});

describe("signup, reset, and change-password", () => {
  test("rejects a too-short new password on signup and reset", () => {
    const result = PasswordAndConfirmPasswordSchema.safeParse({
      password: elevenCharacters,
      confirmPassword: elevenCharacters,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message === "Password is too short")).toBe(
        true,
      );
    }
  });

  test("accepts a 12 character password when the confirmation matches", () => {
    const result = PasswordAndConfirmPasswordSchema.safeParse({
      password: twelveCharacters,
      confirmPassword: twelveCharacters,
    });
    expect(result.success).toBe(true);
  });

  test("rejects a short replacement password and still accepts a short current password", () => {
    const currentPassword = ExistingPasswordSchema.safeParse(previousMinimum);
    expect(currentPassword.success).toBe(true);

    const newPassword = PasswordSchema.safeParse(previousMinimum);
    expect(newPassword.success).toBe(false);
    if (!newPassword.success) {
      expect(
        newPassword.error.issues.some((issue) => issue.message === "Password is too short"),
      ).toBe(true);
    }

    expect(PasswordSchema.safeParse(twelveCharacters).success).toBe(true);
  });
});

describe("ExistingPasswordSchema", () => {
  test("accepts a password that would fail the new 12 character minimum", () => {
    expect(ExistingPasswordSchema.safeParse(previousMinimum).success).toBe(true);
    expect(ExistingPasswordSchema.safeParse(elevenCharacters).success).toBe(true);
  });

  test("still rejects a password over 72 bytes", () => {
    const result = ExistingPasswordSchema.safeParse("a".repeat(PASSWORD_MAX_BYTES + 1));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message === "Password is too long")).toBe(
        true,
      );
    }
  });

  test("still requires a password", () => {
    for (const value of [undefined, ""]) {
      const missing = ExistingPasswordSchema.safeParse(value);
      expect(missing.success).toBe(false);
      if (!missing.success) {
        expect(missing.error.issues.some((issue) => issue.message === "Password is required")).toBe(
          true,
        );
      }
    }
  });
});
