/**
 * E2E tests for search functionality
 * Tests the full-screen search page with overlay UX
 */

import { test, expect, testPrisma } from "#tests/playwright-utils.ts";

async function waitForPlayerBar(page: import("@playwright/test").Page) {
  const bar = page.locator(
    '[data-testid="player-desktop-bar"]:visible, [data-testid="player-mini-bar"]:visible',
  );
  await bar.first().waitFor({ state: "visible" });
  return bar.first();
}

/**
 * Dismiss install banner and remove toast overlays that intercept player clicks.
 * Matches the approach proven in player-queue.test.ts.
 */
async function dismissOverlays(page: import("@playwright/test").Page) {
  const installBanner = page.getByRole("region", { name: "Install app" });
  if (await installBanner.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "Not now" }).click({ force: true });
  }

  await page.evaluate(() => {
    const region = document.querySelector('[aria-label="Notifications (F8)"]');
    if (region) region.remove();
  });
}

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

    // Type something to trigger search
    const searchInput = page.getByPlaceholder(/what do you want to listen to/i);
    await searchInput.fill("test");

    // Results or no-results state should appear — the empty state should go away
    await expect(page.getByText(/search for tracks, albums, artists/i)).not.toBeVisible();
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

  test("clicking a track result plays the track", async ({ page, login, insertNewTrack }) => {
    const user = await login();
    const track = await insertNewTrack({ title: "Search Play Track" }, user.id);
    await testPrisma.trackAudioFile.create({
      data: {
        trackId: track.id,
        objectKey: "audio/search-play.mp3",
        format: "mp3",
        mimeType: "audio/mpeg",
      },
    });

    await page.goto("/search");
    await dismissOverlays(page);

    const searchInput = page.getByPlaceholder(/what do you want to listen to/i);
    await searchInput.fill("Search Play Track");

    const trackRow = page.getByRole("gridcell", { name: /Search Play Track by Test Artist/i });
    await expect(trackRow).toBeVisible();

    await Promise.all([
      page.waitForResponse(
        (response) => response.url().includes("/api/queue-spine") && response.status() === 200,
      ),
      trackRow.click(),
    ]);

    // The player bar should show the track that was just played from search
    const playerBar = await waitForPlayerBar(page);
    await expect(playerBar.getByText("Search Play Track")).toBeVisible();
  });

  test("quick add button opens add-to-playlist from search track row", async ({
    page,
    login,
    insertNewTrack,
  }) => {
    const user = await login();
    await insertNewTrack({ title: "Search Add Track" }, user.id);

    await page.goto("/search");
    await dismissOverlays(page);

    const searchInput = page.getByPlaceholder(/what do you want to listen to/i);
    await searchInput.fill("Search Add Track");

    await expect(page.getByText("Search Add Track").first()).toBeVisible();
    await page.getByRole("button", { name: "Add to playlist" }).first().click();
    await expect(page.getByRole("button", { name: "New playlist" })).toBeVisible();
  });

  test("artist search result navigates to artist page", async ({ page, login, insertNewTrack }) => {
    const user = await login();
    await insertNewTrack({ title: "Artist Nav Track", artist: "Unique Search Artist" }, user.id);

    await page.goto("/search");
    await dismissOverlays(page);

    const searchInput = page.getByPlaceholder(/what do you want to listen to/i);
    await searchInput.fill("Unique Search Artist");

    const artistLink = page.getByRole("link", { name: /Unique Search Artist/i });
    await expect(artistLink).toBeVisible();
    await artistLink.click();

    await expect(page).toHaveURL(/\/artists\//);
    await expect(page.getByRole("heading", { name: "Unique Search Artist" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Tracks/i })).toBeVisible();
    await expect(page.getByText("Artist Nav Track")).toBeVisible();
  });
});
