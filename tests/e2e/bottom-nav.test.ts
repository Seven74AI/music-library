/**
 * E2E tests for bottom navigation bar
 */

import { test, expect } from "#tests/playwright-utils.ts";

/**
 * Helper: dismiss the fixed "Install app" banner if visible.
 * The home page also renders an in-flow card with the same button name, so the
 * click is scoped to the fixed banner and must land without forcing through the nav.
 */
async function dismissInstallBanner(page: import("@playwright/test").Page) {
  const installBanner = page.getByTestId("install-app-banner");
  const notNow = installBanner.getByRole("button", { name: "Not now" });
  if (await notNow.isVisible().catch(() => false)) {
    await notNow.click();
  }
}

test.describe("Bottom Navigation", () => {
  test("bottom nav is visible with 6 tabs", { tag: "@smoke" }, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");

    const bottomNav = page.getByRole("navigation", { name: /main navigation/i });
    await expect(bottomNav).toBeVisible();

    // 6 tabs: Home, Discover, Search, My Library, My Playlists, History
    const tabs = bottomNav.getByRole("listitem");
    await expect(tabs).toHaveCount(6);

    // Check each tab label
    await expect(bottomNav.getByText("Home")).toBeVisible();
    await expect(bottomNav.getByText("Discover")).toBeVisible();
    await expect(bottomNav.getByText("Search")).toBeVisible();
    await expect(bottomNav.getByText("My Library")).toBeVisible();
    await expect(bottomNav.getByText("My Playlists")).toBeVisible();
    await expect(bottomNav.getByText("History")).toBeVisible();
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

  test("discover tab is active on discover page", async ({ page, loginAsAdmin }) => {
    await loginAsAdmin();
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/discover");

    const bottomNav = page.getByRole("navigation", { name: /main navigation/i });
    const discoverLink = bottomNav.getByRole("link", { name: /discover/i });
    await expect(discoverLink).toBeVisible();
    await expect(page).toHaveURL(/\/discover/);
  });

  test("clicking tabs navigates to correct pages", async ({ page, loginAsAdmin }) => {
    await loginAsAdmin();
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await dismissInstallBanner(page);

    const bottomNav = page.getByRole("navigation", { name: /main navigation/i });

    // Navigate to Discover
    await bottomNav.getByRole("link", { name: /discover/i }).click();
    await expect(page).toHaveURL(/\/discover/);

    // Navigate to Search
    await bottomNav.getByRole("link", { name: /search/i }).click();
    await expect(page).toHaveURL(/\/search/);
    await expect(bottomNav.getByRole("link", { name: /search/i })).toHaveAttribute(
      "aria-current",
      "page",
    );

    // Dismiss search overlay via back arrow (search sits above bottom nav at z-52)
    await page.getByRole("button", { name: /back/i }).click();
    await expect(page).not.toHaveURL(/\/search/);

    // Wait for bottom nav to be visible and clickable again
    await expect(bottomNav.getByRole("link", { name: /home/i })).toBeVisible();

    // Navigate back to Home
    await bottomNav.getByRole("link", { name: /home/i }).click();
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

  test("search is not in the header on mobile", { tag: "@smoke" }, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");

    const header = page.getByRole("banner");
    // Header search is desktop-only; mobile uses the bottom nav Search tab
    await expect(header.getByRole("searchbox")).not.toBeVisible();
    await expect(header.getByRole("link", { name: /^search$/i })).not.toBeVisible();
    await expect(header.locator('a[href="/search"]')).not.toBeVisible();

    const bottomNav = page.getByRole("navigation", { name: /main navigation/i });
    await expect(bottomNav.getByRole("link", { name: /search/i })).toBeVisible();
  });

  test("user menu hides bottom-nav routes on mobile", async ({ page, login }) => {
    await login();
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");

    await page.getByRole("button", { name: /user menu/i }).click();
    const menu = page.getByRole("menu");

    await expect(menu.getByRole("menuitem", { name: /profile/i })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /downloads/i })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /my library/i })).not.toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /my playlists/i })).not.toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /history/i })).not.toBeVisible();

    // Close the menu first — Radix sets aria-hidden on the rest of the page while open,
    // which hides bottom-nav links from getByRole.
    await page.keyboard.press("Escape");
    await expect(menu).not.toBeVisible();

    const bottomNav = page.getByRole("navigation", { name: /main navigation/i });
    await expect(bottomNav.getByRole("link", { name: /my music library/i })).toBeVisible();
    await expect(bottomNav.getByRole("link", { name: /my playlists/i })).toBeVisible();
    await expect(bottomNav.getByRole("link", { name: /listening history/i })).toBeVisible();
  });
});
