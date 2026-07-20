/**
 * E2E tests for bottom navigation bar
 */

import { test, expect } from "#tests/playwright-utils.ts";

/**
 * Helper: dismiss the "Install app" banner if visible.
 */
async function dismissInstallBanner(page: import("@playwright/test").Page) {
  const installBanner = page.getByRole("region", { name: "Install app" });
  if (await installBanner.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "Not now" }).click({ force: true });
  }
}

test.describe("Bottom Navigation", () => {
  test("bottom nav is visible with 4 tabs", { tag: "@smoke" }, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");

    const bottomNav = page.getByRole("navigation", { name: /main navigation/i });
    await expect(bottomNav).toBeVisible();

    // 4 tabs: Home, Search, My Library, My Playlists
    const tabs = bottomNav.getByRole("listitem");
    await expect(tabs).toHaveCount(4);

    // Check each tab label
    await expect(bottomNav.getByText("Home")).toBeVisible();
    await expect(bottomNav.getByText("Search")).toBeVisible();
    await expect(bottomNav.getByText("My Library")).toBeVisible();
    await expect(bottomNav.getByText("My Playlists")).toBeVisible();
  });

  test("home tab is active on homepage", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");

    const bottomNav = page.getByRole("navigation", { name: /main navigation/i });
    const homeLink = bottomNav.getByRole("link", { name: /home/i });
    await expect(homeLink).toHaveAttribute("aria-current", "page");
  });

  test("search tab is active on search page", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/search");

    const bottomNav = page.getByRole("navigation", { name: /main navigation/i });
    const searchLink = bottomNav.getByRole("link", { name: /search/i });
    await expect(searchLink).toHaveAttribute("aria-current", "page");
  });

  test("clicking tabs navigates to correct pages", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await dismissInstallBanner(page);

    const bottomNav = page.getByRole("navigation", { name: /main navigation/i });

    // Navigate to Search
    await bottomNav.getByRole("link", { name: /search/i }).click();
    await expect(page).toHaveURL(/\/search/);
    await expect(bottomNav.getByRole("link", { name: /search/i })).toHaveAttribute(
      "aria-current",
      "page",
    );

    // Navigate back to Home
    await bottomNav.getByRole("link", { name: /^home$/i }).click();
    await expect(page).toHaveURL(/\/(\?|$)/);
    await expect(bottomNav.getByRole("link", { name: /home/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("bottom nav is visible on authenticated pages", async ({ page, loginAsAdmin }) => {
    await loginAsAdmin();
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");

    const bottomNav = page.getByRole("navigation", { name: /main navigation/i });
    await expect(bottomNav).toBeVisible();
  });

  test("search bar is not in the header", { tag: "@smoke" }, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");

    const header = page.getByRole("banner");
    // The search bar (searchbox) should NOT be in the header
    await expect(header.getByRole("searchbox")).not.toBeVisible();
  });
});
