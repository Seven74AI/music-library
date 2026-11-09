import { invariant } from "@epic-web/invariant";
import { type Page, expect } from "@playwright/test";

/** Submit /verify when OTP may live in session (email link) or on the form. */
export async function submitVerification(page: Page, code?: string) {
  const sessionBacked = page.getByText(/confirm to continue with your pending verification/i);
  if (await sessionBacked.isVisible()) {
    await page
      .getByRole("main")
      .getByRole("button", { name: /submit/i })
      .click();
    return;
  }
  invariant(code, "Verification code required when OTP field is shown");
  const codeInput = page.getByRole("textbox", { name: /code/i });
  await expect(codeInput).toBeVisible({ timeout: 15_000 });
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
