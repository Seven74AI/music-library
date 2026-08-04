/**
 * E2E tests for artist page browsing and track playback.
 */

import { test, expect, testPrisma } from "#tests/playwright-utils.ts";

async function waitForPlayerBar(page: import("@playwright/test").Page) {
  const bar = page.locator(
    '[data-testid="player-desktop-bar"]:visible, [data-testid="player-mini-bar"]:visible',
  );
  await bar.first().waitFor({ state: "visible", timeout: 15000 });
  return bar.first();
}

test.describe("Artist Page", () => {
  test("clicking a track plays music without navigating to track detail", async ({
    page,
    login,
    insertNewTrack,
  }) => {
    test.setTimeout(60_000);
    const user = await login();
    const artistName = "Artist Page Play Artist";
    const track = await insertNewTrack(
      { title: "Artist Page Play Track", artist: artistName },
      user.id,
    );
    await testPrisma.trackAudioFile.create({
      data: {
        trackId: track.id,
        objectKey: "audio/artist-page-play.mp3",
        format: "mp3",
        mimeType: "audio/mpeg",
      },
    });

    const artist = await testPrisma.artist.findFirst({
      where: { name: artistName },
      select: { id: true },
    });
    expect(artist).not.toBeNull();

    await page.goto(`/artists/${artist!.id}`);
    await expect(page.getByRole("heading", { name: artistName })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("heading", { name: /Tracks/i })).toBeVisible();

    await Promise.all([
      page.waitForResponse(
        (response) => response.url().includes("/api/queue-spine") && response.status() === 200,
        { timeout: 15000 },
      ),
      page
        .getByRole("gridcell", { name: new RegExp(`Artist Page Play Track by ${artistName}`) })
        .click(),
    ]);

    await expect(page).toHaveURL(new RegExp(`/artists/${artist!.id}`));
    const playerBar = await waitForPlayerBar(page);
    await expect(playerBar.getByText("Artist Page Play Track")).toBeVisible();
  });

  test("shows albums and tracks sections with counts", async ({ page, login, insertNewTrack }) => {
    const user = await login();
    const artistName = "Artist Page Sections Artist";
    await insertNewTrack({ title: "Artist Section Track", artist: artistName }, user.id);

    const artist = await testPrisma.artist.findFirst({
      where: { name: artistName },
      select: { id: true },
    });
    expect(artist).not.toBeNull();

    await page.goto(`/artists/${artist!.id}`);
    await expect(page.getByRole("heading", { name: artistName })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("heading", { name: /Tracks \(1\)/i })).toBeVisible();
    await expect(page.getByText("Artist Section Track")).toBeVisible();
  });
});
