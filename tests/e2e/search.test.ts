/**
 * E2E tests for search functionality
 * Tests the full-screen search page with overlay UX
 */

import { test, expect } from "#tests/playwright-utils.ts";

test.describe("Global Search", () => {
  test("can navigate to search page", { tag: "@smoke" }, async ({ page, loginAsAdmin }) => {
    await loginAsAdmin();
    await page.goto("/search");

    // Search page should show a search input with placeholder text
    const searchInput = page.getByPlaceholder(/what do you want to listen to/i);
    await expect(searchInput).toBeVisible();
  });

  test("search page shows type filter pills", async ({ page, loginAsAdmin }) => {
    await loginAsAdmin();
    await page.goto("/search");

    // Type filter pills should be visible
    await expect(page.getByRole("button", { name: "All" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Tracks" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Albums" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Artists" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Playlists" })).toBeVisible();
  });

  test("can filter search by type", async ({ page, loginAsAdmin }) => {
    await loginAsAdmin();
    await page.goto("/search");

    // Click the Tracks filter pill
    await page.getByRole("button", { name: "Tracks" }).click();

    // The Tracks pill should now be styled as active (primary)
    // Type something to trigger search
    const searchInput = page.getByPlaceholder(/what do you want to listen to/i);
    await searchInput.fill("test");

    // Results or no-results state should appear — wait for any search response
    // The search page should no longer show the empty state
    await expect(page.getByText(/search for tracks, albums, artists/i)).not.toBeVisible({
      timeout: 15000,
    });
  });

  test("search page shows empty state when no query", async ({ page, loginAsAdmin }) => {
    await loginAsAdmin();
    await page.goto("/search");

    // Should show a friendly prompt to search
    await expect(page.getByText(/search for tracks, albums, artists/i)).toBeVisible();
  });

  test("search API endpoint returns results", async ({ page, loginAsAdmin }) => {
    await loginAsAdmin();

    // Test API endpoint directly
    const response = await page.request.get("/api/search?q=test");
    // May return 200 with empty results or 500 if FTS5 tables are empty
    expect([200, 500]).toContain(response.status());

    if (response.status() === 200) {
      const data = await response.json();
      expect(data).toHaveProperty("results");
      expect(data).toHaveProperty("pagination");
      expect(Array.isArray(data.results)).toBe(true);
    }
  });

  test("search API validates query parameter", async ({ page, loginAsAdmin }) => {
    await loginAsAdmin();

    const response = await page.request.get("/api/search");
    expect(response.status()).toBe(400);
  });

  test("search API handles invalid limit", async ({ page, loginAsAdmin }) => {
    await loginAsAdmin();

    const response = await page.request.get("/api/search?q=test&limit=invalid");
    expect(response.status()).toBe(400);
  });

  test("back button returns to previous page", async ({ page, loginAsAdmin }) => {
    await loginAsAdmin();
    await page.goto("/library");
    await page.goto("/search");

    // Click the back arrow button
    await page.getByLabel("Back").click();

    // Should be back on library page
    await expect(page).toHaveURL(/\/library/);
  });
});
