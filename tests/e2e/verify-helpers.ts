import { invariant } from "@epic-web/invariant";
import { type Page, expect } from "@playwright/test";

/** Submit /verify by entering the OTP from the email (or 2FA app) into the form. */
export async function submitVerification(page: Page, code: string) {
  invariant(code, "Verification code required");
  const codeInput = page.getByRole("textbox", { name: /code/i });
  await expect(codeInput).toBeVisible({ timeout: 15_000 });
  await codeInput.click();
  await codeInput.fill(code);
  await page
    .getByRole("main")
    .getByRole("button", { name: /submit/i })
    .click();
}

export async function expectLoggedIn(page: Page) {
  await expect(page.getByRole("button", { name: /user menu/i })).toBeVisible({
    timeout: 15_000,
  });
}
