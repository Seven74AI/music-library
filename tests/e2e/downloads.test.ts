import { expect, test } from "#tests/playwright-utils.ts";

test.describe("Downloads page", () => {
  test("uses user-facing download copy without pinned", async ({ page, login }) => {
    await login();
    await page.goto("/downloads", { waitUntil: "load" });

    await expect(page.getByRole("heading", { name: "Downloads" })).toBeVisible();
    await expect(page.getByText(/downloaded · .* auto-cached/i)).toBeVisible();
    await expect(page.getByText(/pinned/i)).toHaveCount(0);
  });
});