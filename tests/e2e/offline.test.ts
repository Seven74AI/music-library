import { test, expect, testPrisma } from "#tests/playwright-utils.ts";

async function dispatchOffline(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    try {
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        get: () => false,
      });
    } catch {
      // navigator.onLine may already be false via Playwright offline mode
    }
    window.dispatchEvent(new Event("offline"));
  });
  await page.waitForFunction(() => navigator.onLine === false);
}

async function emulateOfflineLoaderRequests(page: import("@playwright/test").Page) {
  // Abort React Router data requests so client middleware can substitute offline fallbacks.
  await page.route(/\.data(?:\?.*)?$/, (route) => route.abort("internetdisconnected"));
  await dispatchOffline(page);
}

async function navigateOfflineClient(
  page: import("@playwright/test").Page,
  navigate: () => Promise<void>,
) {
  await navigate();
  await page.waitForLoadState("domcontentloaded");
  await dispatchOffline(page);
}

test.describe("Offline mode", () => {
  test("shows offline status when opening home without network", async ({ page, login }) => {
    await login();
    await page.goto("/library");
    await page.waitForLoadState("domcontentloaded");

    await emulateOfflineLoaderRequests(page);

    await navigateOfflineClient(page, async () => {
      await Promise.all([
        page.waitForURL("/"),
        page.getByRole("link", { name: /7d music/i }).click(),
      ]);
    });

    await expect(page.getByRole("status")).toContainText(
      "You're offline. Showing downloaded music only.",
      { timeout: 10000 },
    );
  });

  test("shows offline banner on supported pages", async ({ page, login }) => {
    await login();
    await page.goto("/library");
    await page.waitForLoadState("domcontentloaded");

    await emulateOfflineLoaderRequests(page);

    await navigateOfflineClient(page, async () => {
      await Promise.all([
        page.waitForURL(/\/search(?:\?.*)?$/),
        page.locator('header a[href="/search"]').first().click(),
      ]);
    });

    await expect(page.getByRole("status")).toContainText(
      "You're offline. Showing downloaded music only.",
      { timeout: 10000 },
    );
  });

  test("shows offline blocker on search instead of browser network error", async ({
    page,
    login,
  }) => {
    await login();
    await page.goto("/library");
    await page.waitForLoadState("domcontentloaded");

    await emulateOfflineLoaderRequests(page);

    await navigateOfflineClient(page, async () => {
      await Promise.all([
        page.waitForURL(/\/search(?:\?.*)?$/),
        page.locator('header a[href="/search"]').first().click(),
      ]);
    });

    await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible({
      timeout: 10000,
    });
  });

  test("shows offline blocker on settings instead of a blank page", async ({ page, login }) => {
    await login();
    await page.goto("/library");
    await page.waitForLoadState("domcontentloaded");

    await emulateOfflineLoaderRequests(page);

    await navigateOfflineClient(page, async () => {
      await page.goto("/settings/profile");
    });

    await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible({
      timeout: 10000,
    });
  });

  test("shows offline blocker on music services instead of a blank page", async ({
    page,
    login,
  }) => {
    await login();
    await page.goto("/library");
    await page.waitForLoadState("domcontentloaded");

    await emulateOfflineLoaderRequests(page);

    await navigateOfflineClient(page, async () => {
      await page.goto("/music/services");
    });

    await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible({
      timeout: 10000,
    });
  });

  test("can download and play a track while offline", async ({ page, login, insertNewTrack }) => {
    test.setTimeout(60_000);
    const user = await login();

    // Create a track with audio so offline playlist download can pin it
    const track = await insertNewTrack(
      { title: "Offline Playback Track", artist: "Offline Artist" },
      user.id,
    );
    await testPrisma.trackAudioFile.create({
      data: {
        trackId: track.id,
        objectKey: `audio/${track.id}.mp3`,
        format: "mp3",
        mimeType: "audio/mpeg",
      },
    });

    const playlist = await testPrisma.userPlaylist.create({
      data: {
        title: "Offline Playback Playlist",
        description: null,
        ownerId: user.id,
        tracks: {
          create: [{ trackId: track.id, position: 0 }],
        },
      },
    });

    // Mock the audio streaming endpoint to return valid bytes.
    // In MOCKS mode, storage is not configured, so the server can't
    // serve real audio bytes. We intercept at the network level.
    await page.route(`**/resources/audio/${track.id}?stream=1`, async (route) => {
      // Return a minimal valid MP3/MPEG frame header followed by silence
      // so the download succeeds and the byte count is non-zero.
      // MPEG1 Layer3 128kbps 44100Hz stereo frame sync + padding
      const header = new Uint8Array([
        0xff,
        0xfb,
        0x90,
        0x00, // frame sync + MPEG1 Layer3 128kbps 44100Hz
      ]);
      // Pad with enough bytes to look like a real download (100 bytes of silence)
      const body = new Uint8Array(104);
      body.set(header, 0);
      await route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Length": String(body.byteLength),
          "Accept-Ranges": "bytes",
        },
        body: Buffer.from(body),
      });
    });

    // Pin for offline via playlist download (library menu is audio-file download)
    await page.goto(`/playlists/${playlist.id}`, { timeout: 30000 });
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
    await page.getByRole("button", { name: "Download playlist" }).click();
    await expect(page.getByTestId("toast").getByText("Playlist downloaded")).toBeVisible({
      timeout: 15000,
    });
    await page.waitForTimeout(1500);

    // Navigate to library to play while offline
    await page.goto("/library", { timeout: 30000 });
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 });

    const trackRow = page.getByRole("gridcell", {
      name: /Offline Playback Track by Offline Artist/i,
    });
    await trackRow.scrollIntoViewIfNeeded();
    await expect(trackRow).toBeVisible({ timeout: 10000 });

    // Go offline using Playwright context
    await page.context().setOffline(true);

    // Click the track to play it while offline
    await page
      .getByRole("gridcell", {
        name: /Offline Playback Track by Offline Artist/i,
      })
      .click();

    // Verify the player bar appears with track info
    const playerBar = page.getByTestId("player-desktop-bar");
    await expect(playerBar).toBeVisible({ timeout: 10000 });
    await expect(playerBar.getByText("Offline Playback Track")).toBeVisible();
    await expect(playerBar.getByText("Offline Artist")).toBeVisible();

    // Verify the play/pause button is present (playback controls visible)
    await expect(playerBar.getByLabel(/^(Play|Pause)$/i)).toBeVisible({ timeout: 5000 });

    // Restore network
    await page.context().setOffline(false);
  });
});
