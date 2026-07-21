/**
 * E2E tests for YouTube import page
 */

import { test, expect } from "#tests/playwright-utils.ts";

test.describe("YouTube Import Page", () => {
  test("can navigate to the import page", { tag: "@smoke" }, async ({ page, loginAsAdmin }) => {
    await loginAsAdmin();
    await page.goto("/music/services/youtube/import");

    await expect(page.getByRole("heading", { name: /import from youtube/i })).toBeVisible();
  });

  test("shows search form with input and button", async ({ page, loginAsAdmin }) => {
    await loginAsAdmin();
    await page.goto("/music/services/youtube/import");

    // Search input should be visible
    const searchInput = page.getByPlaceholder(/enter youtube url or search by artist/i);
    await expect(searchInput).toBeVisible();

    // Search button should be visible — target the form's submit button,
    // not the global header search button which also matches /search/i
    await expect(
      page.locator('form[method="post"]').getByRole("button", { name: /search/i }),
    ).toBeVisible();
  });

  test("can search and see results with mock data", async ({ page, loginAsAdmin }) => {
    await loginAsAdmin();
    await page.goto("/music/services/youtube/import");

    // Type a search query
    const searchInput = page.getByPlaceholder(/enter youtube url or search by artist/i);
    await searchInput.fill("test song");
    await page
      .locator('form[method="post"]')
      .getByRole("button", { name: /search/i })
      .click();

    // Wait for results to load (mock data returns 5 results)
    // Wait for results — next expect auto-waits

    // Should show search results heading
    await expect(page.getByText(/search results/i)).toBeVisible();

    // Should show mock video titles
    await expect(page.getByText(/mock video.*test song/i).first()).toBeVisible();
  });

  test("import button is present on search results", async ({ page, loginAsAdmin }) => {
    await loginAsAdmin();
    await page.goto("/music/services/youtube/import");

    // Search
    const searchInput = page.getByPlaceholder(/enter youtube url or search by artist/i);
    await searchInput.fill("test");
    await page
      .locator('form[method="post"]')
      .getByRole("button", { name: /search/i })
      .click();

    // Wait for results to appear — expect auto-waits
    await expect(page.getByText(/search results/i)).toBeVisible();

    // Each result should have an Import button
    const importButtons = page.getByRole("button", { name: /import/i });
    // Count only after confirming at least one is visible (auto-wait)
    await expect(importButtons.first()).toBeVisible();
    const count = await importButtons.count();
    expect(count).toBeGreaterThan(0);
  });

  test("can navigate back to YouTube services", async ({ page, loginAsAdmin }) => {
    await loginAsAdmin();
    await page.goto("/music/services/youtube/import");

    // Click back button
    await page.getByRole("link", { name: /back/i }).click();

    // Should navigate to YouTube services page
    await page.waitForURL("**/music/services/youtube");
  });
});
