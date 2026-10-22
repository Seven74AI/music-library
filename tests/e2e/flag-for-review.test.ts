/**
 * Curators and admins can flag a track, artist, or album for review.
 * Listeners do not see the action.
 */

import { test, expect, testPrisma, dismissOverlays } from "#tests/playwright-utils.ts";

test.describe.configure({ mode: "serial" });

async function openTrackActions(page: import("@playwright/test").Page) {
  const menuButton = page.getByRole("button", { name: "More actions" });
  const details = page
    .getByRole("menuitem", { name: /view track details/i })
    .or(page.getByRole("button", { name: /view track details/i }));
  // Dev mode reloads once while Vite optimizes dependencies. Wait through that
  // before treating a missing menu as a product failure.
  for (let attempt = 0; attempt < 3; attempt++) {
    await expect(menuButton).toBeVisible({ timeout: 15000 });
    await menuButton.click({ timeout: 15000 });
    try {
      await expect(details).toBeVisible({ timeout: 3000 });
      return;
    } catch {
      // Menu closed by a reload; try again once the row is back.
    }
  }
  await expect(details).toBeVisible();
}

async function clickFlagForReview(page: import("@playwright/test").Page) {
  const dialog = page.getByRole("heading", { name: "Flag for Review" });
  const trigger = page.getByRole("button", { name: /^flag for review$/i });
  for (let attempt = 0; attempt < 3; attempt++) {
    await dismissOverlays(page);
    await trigger.click();
    try {
      await expect(dialog).toBeVisible({ timeout: 2500 });
      return;
    } catch {
      // The first click can land before the route finishes hydrating.
    }
  }
  await expect(dialog).toBeVisible();
}

async function flagOpenEntity(
  page: import("@playwright/test").Page,
  entityName: string,
  comment: string,
  screenshotName?: string,
) {
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Flag for Review" })).toBeVisible();
  await expect(dialog.getByText(entityName)).toBeVisible();
  if (screenshotName) {
    await page.screenshot({
      path: `/opt/cursor/artifacts/${screenshotName}.png`,
      fullPage: true,
    });
  }
  await dialog.getByRole("combobox").click();
  await page.getByRole("option", { name: "Wrong metadata" }).click();
  await dialog.getByLabel("Comment (optional)").fill(comment);
  const response = page.waitForResponse(
    (result) =>
      result.url().includes("/api/curator/queue/flag") && result.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Flag for Review" }).click();
  expect((await response).ok()).toBe(true);
  await expect(dialog).toBeHidden();
}

test("listeners do not see Flag for review", async ({ page, login, insertNewTrack }) => {
  test.setTimeout(45_000);
  const user = await login();
  const artistName = `Listener Flag Artist ${Date.now()}`;
  const title = "Listener Flag Track";
  await insertNewTrack({ title, artist: artistName }, user.id);
  const artist = await testPrisma.artist.findFirst({
    where: { name: artistName },
    select: { id: true },
  });
  expect(artist).not.toBeNull();

  await page.goto(`/artists/${artist!.id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: artistName })).toBeVisible();
  await dismissOverlays(page);
  await expect(page.getByRole("button", { name: /flag for review/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /edit artist/i })).toHaveCount(0);

  await openTrackActions(page);
  await expect(page.getByRole("menuitem", { name: /flag for review/i })).toHaveCount(0);
});

test("admin can flag an artist, a track, and an album", async ({
  page,
  loginAsAdmin,
  insertNewTrack,
}) => {
  test.setTimeout(60_000);
  const user = await loginAsAdmin();
  const artistName = `Admin Flag Artist ${Date.now()}`;
  const title = "Admin Flag Track";
  const albumName = `Admin Flag Album ${Date.now()}`;
  const created = await insertNewTrack({ title, artist: artistName }, user.id);
  const artist = await testPrisma.artist.findFirst({
    where: { name: artistName },
    select: { id: true },
  });
  expect(artist).not.toBeNull();
  const album = await testPrisma.album.create({
    data: {
      name: albumName,
      artistId: artist!.id,
      tracks: { connect: { id: created.id } },
    },
  });

  try {
    await page.goto(`/artists/${artist!.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: artistName })).toBeVisible();
    await dismissOverlays(page);
    await expect(page.getByRole("button", { name: /edit artist/i })).toBeVisible();
    await clickFlagForReview(page);
    await flagOpenEntity(page, artistName, "Artist metadata needs a look", "flag-artist-dialog");

    const artistItem = await testPrisma.reviewQueueItem.findFirst({
      where: { entityType: "artist", entityId: artist!.id, source: "curator" },
    });
    expect(artistItem?.issueType).toBe("wrong_metadata");
    expect(artistItem?.description).toBe("Artist metadata needs a look");
    expect(artistItem?.priority).toBe(2);
    expect(artistItem?.status).toBe("open");
    expect(artistItem?.reporterId).toBe(user.id);

    await openTrackActions(page);
    await expect(page.getByRole("menuitem", { name: /flag for review/i })).toBeVisible();
    await page.screenshot({ path: "/opt/cursor/artifacts/flag-track-menu.png" });
    await page.getByRole("menuitem", { name: /flag for review/i }).click();
    await flagOpenEntity(page, title, "Track title looks wrong", "flag-track-dialog");

    const trackItem = await testPrisma.reviewQueueItem.findFirst({
      where: { entityType: "track", entityId: created.id, source: "curator" },
    });
    expect(trackItem?.issueType).toBe("wrong_metadata");
    expect(trackItem?.description).toBe("Track title looks wrong");
    expect(trackItem?.reporterId).toBe(user.id);

    await page.goto(`/albums/${album.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: albumName })).toBeVisible();
    await dismissOverlays(page);
    await expect(page.getByRole("button", { name: /edit album/i })).toBeVisible();
    await clickFlagForReview(page);
    await flagOpenEntity(page, albumName, "Album year is missing", "flag-album-dialog");

    const albumItem = await testPrisma.reviewQueueItem.findFirst({
      where: { entityType: "album", entityId: album.id, source: "curator" },
    });
    expect(albumItem?.issueType).toBe("wrong_metadata");
    expect(albumItem?.description).toBe("Album year is missing");
    expect(albumItem?.priority).toBe(2);
    expect(albumItem?.reporterId).toBe(user.id);
  } finally {
    await testPrisma.reviewQueueItem.deleteMany({
      where: { entityId: { in: [artist!.id, created.id, album.id] } },
    });
    await testPrisma.album.delete({ where: { id: album.id } }).catch(() => undefined);
  }
});
