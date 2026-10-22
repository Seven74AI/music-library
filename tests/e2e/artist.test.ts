/**
 * E2E tests for artist page browsing and track playback.
 */

import { test, expect, testPrisma, dismissOverlays } from "#tests/playwright-utils.ts";

test.describe.configure({ mode: "serial" });

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
    // Artist spine is ordered createdAt desc, so insert Play Track first (older),
    // then Sibling (newer / first in spine). Play the first spine track so the
    // older sibling remains visible as upcoming in the queue sheet.
    const olderTrack = await insertNewTrack(
      { title: "Artist Page Play Track", artist: artistName },
      user.id,
    );
    const newerTrack = await insertNewTrack(
      { title: "Artist Page Sibling Track", artist: artistName },
      user.id,
    );
    const otherTrack = await insertNewTrack(
      { title: "Artist Page Other Track", artist: "Different Artist" },
      user.id,
    );
    for (const playableTrack of [olderTrack, newerTrack, otherTrack]) {
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

    await page.goto(`/artists/${artist!.id}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await expect(page.getByRole("heading", { name: artistName })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("heading", { name: /Tracks/i })).toBeVisible();
    await dismissOverlays(page);

    await Promise.all([
      page.waitForResponse(
        (response) => response.url().includes("/api/queue-spine") && response.status() === 200,
        { timeout: 15000 },
      ),
      page
        .getByRole("gridcell", { name: new RegExp(`Artist Page Sibling Track by ${artistName}`) })
        .click(),
    ]);

    await expect(page).toHaveURL(new RegExp(`/artists/${artist!.id}`));
    const playerBar = await waitForPlayerBar(page);
    await expect(playerBar.getByText("Artist Page Sibling Track")).toBeVisible();

    await dismissOverlays(page);
    await playerBar.getByLabel("Open queue").click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Queue (2 from artist)" })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "From Artist", exact: true })).toBeVisible();
    await expect(dialog.getByText("Artist Page Sibling Track")).toBeVisible();
    await expect(dialog.getByText("Artist Page Play Track")).toBeVisible();
    await expect(dialog.getByText("Artist Page Other Track")).not.toBeVisible();
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

    await page.goto(`/artists/${artist!.id}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await expect(page.getByRole("heading", { name: artistName })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("heading", { name: /Tracks \(1\)/i })).toBeVisible();
    await expect(page.getByText("Artist Section Track")).toBeVisible();
  });
});
