/**
 * E2E tests for album page browsing and track playback.
 */

import { test, expect, testPrisma } from "#tests/playwright-utils.ts";

async function waitForPlayerBar(page: import("@playwright/test").Page) {
  const bar = page.locator(
    '[data-testid="player-desktop-bar"]:visible, [data-testid="player-mini-bar"]:visible',
  );
  await bar.first().waitFor({ state: "visible", timeout: 15000 });
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
    await expect(installBanner).not.toBeVisible({ timeout: 10000 });
  }

  await page.evaluate(() => {
    const region = document.querySelector('[aria-label="Notifications (F8)"]');
    if (region) region.remove();
  });
}

test.describe("Album Page", () => {
  test("clicking a track uses the album queue context", async ({ page, login, insertNewTrack }) => {
    test.setTimeout(60_000);
    const user = await login();
    const artistName = "Album Page Artist";
    const firstTrack = await insertNewTrack(
      { title: "Album Page Track One", artist: artistName },
      user.id,
    );
    const secondTrack = await insertNewTrack(
      { title: "Album Page Track Two", artist: artistName },
      user.id,
    );
    const otherTrack = await insertNewTrack(
      { title: "Album Page Other Track", artist: "Other Album Artist" },
      user.id,
    );

    for (const playableTrack of [firstTrack, secondTrack, otherTrack]) {
      await testPrisma.trackAudioFile.create({
        data: {
          trackId: playableTrack.id,
          objectKey: `audio/${playableTrack.id}.mp3`,
          format: "mp3",
          mimeType: "audio/mpeg",
        },
      });
    }

    const artist = await testPrisma.artist.findFirst({
      where: { name: artistName },
      select: { id: true },
    });
    expect(artist).not.toBeNull();
    if (!artist) return;

    const album = await testPrisma.album.upsert({
      where: {
        artistId_name: {
          artistId: artist.id,
          name: "Album Page Album",
        },
      },
      update: {},
      create: {
        name: "Album Page Album",
        artistId: artist.id,
      },
      select: { id: true, name: true },
    });

    await testPrisma.track.updateMany({
      where: { id: { in: [firstTrack.id, secondTrack.id] } },
      data: { albumId: album.id },
    });

    await page.goto(`/albums/${album.id}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await expect(page.getByRole("heading", { name: album.name })).toBeVisible({ timeout: 10000 });
    await dismissOverlays(page);

    await Promise.all([
      page.waitForResponse(
        (response) => response.url().includes("/api/queue-spine") && response.status() === 200,
        { timeout: 15000 },
      ),
      page.getByRole("gridcell", { name: /Album Page Track One by Album Page Artist/i }).click(),
    ]);

    const playerBar = await waitForPlayerBar(page);
    await expect(playerBar.getByText("Album Page Track One")).toBeVisible();

    await dismissOverlays(page);
    await playerBar.getByLabel("Open queue").click({ force: true });

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Queue (2 from album)" })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "From Album", exact: true })).toBeVisible();
    await expect(dialog.getByText("Album Page Track One")).toBeVisible();
    await expect(dialog.getByText("Album Page Track Two")).toBeVisible();
    await expect(dialog.getByText("Album Page Other Track")).not.toBeVisible();
  });
});
