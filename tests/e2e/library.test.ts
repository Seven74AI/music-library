import { prisma } from "#app/utils/db.server.ts";
import {
  test,
  expect,
  testPrisma,
  dismissOverlays,
  dismissVisibleToasts,
} from "#tests/playwright-utils.ts";

test.describe("Music Library", () => {
  test("can view library page", { tag: "@smoke" }, async ({ page, login }) => {
    await login();

    await page.goto("/library");
    // Wait for page to load
    await page.waitForLoadState("domcontentloaded");
    // Check for the main heading
    await expect(page.getByRole("heading", { name: /music library/i })).toBeVisible({
      timeout: 10000,
    });
    // Should show empty state or tracks
    await expect(page.getByRole("heading", { name: "No tracks yet" })).toBeVisible({
      timeout: 10000,
    });
  });

  test("shows tracks in library", { tag: "@smoke" }, async ({ page, login, insertNewTrack }) => {
    const user = await login();

    // Create a test track using the fixture (will be cleaned up automatically)
    await insertNewTrack({}, user.id);

    await page.goto("/library");
    // Wait for page to load
    await page.waitForLoadState("domcontentloaded");

    // Should show the track in the table
    await expect(page.getByText("Test Track").first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Test Artist").first()).toBeVisible({ timeout: 10000 });
  });

  test("can view individual track", async ({ page, login, insertNewTrack }) => {
    const user = await login();

    // Create a test track using the fixture (will be cleaned up automatically)
    const track = await insertNewTrack({}, user.id);

    await page.goto(`/library/${track.id}`);
    // Wait for page to load
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByRole("heading", { name: "Test Track", level: 1 })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole("link", { name: "Test Artist", exact: true })).toBeVisible({
      timeout: 10000,
    });
  });

  test("playing from track detail uses a one-track queue", async ({
    page,
    login,
    insertNewTrack,
  }) => {
    test.setTimeout(60_000);
    const user = await login();
    const track = await insertNewTrack({ title: "Detail Queue Track" }, user.id);
    const otherTrack = await insertNewTrack({ title: "Detail Queue Other" }, user.id);

    for (const playableTrack of [track, otherTrack]) {
      await testPrisma.trackAudioFile.create({
        data: {
          trackId: playableTrack.id,
          objectKey: `audio/${playableTrack.id}.mp3`,
          format: "mp3",
          mimeType: "audio/mpeg",
        },
      });
    }

    await page.goto(`/library/${track.id}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByRole("heading", { name: "Detail Queue Track", level: 1 })).toBeVisible({
      timeout: 10000,
    });
    const playButton = page.getByRole("button", { name: "Play", exact: true });
    // The button is in the server HTML. Wait until React has hydrated it so the click runs play.
    await expect
      .poll(() =>
        playButton.evaluate((button) =>
          Object.keys(button).some(
            (key) => key.startsWith("__reactProps") || key.startsWith("__reactFiber"),
          ),
        ),
      )
      .toBe(true);
    await dismissOverlays(page);

    await Promise.all([
      page.waitForResponse(
        (response) => response.url().includes("/api/queue-spine") && response.status() === 200,
        { timeout: 15000 },
      ),
      playButton.click(),
    ]);

    const playerBar = page.locator(
      '[data-testid="player-desktop-bar"]:visible, [data-testid="player-mini-bar"]:visible',
    );
    await expect(playerBar.first()).toBeVisible({ timeout: 10000 });
    await expect(playerBar.getByText("Detail Queue Track")).toBeVisible();

    await dismissVisibleToasts(page);
    await playerBar.getByLabel("Open queue").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Queue (1 from track)" })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "From Track", exact: true })).toBeVisible();
    await expect(dialog.getByText("Detail Queue Track")).toBeVisible();
    await expect(dialog.getByText("Detail Queue Other")).not.toBeVisible();
  });

  test("can create playlist from library track row", async ({ page, login, insertNewTrack }) => {
    const user = await login();
    const track = await insertNewTrack({}, user.id);

    await page.goto("/library");
    await page.waitForLoadState("domcontentloaded");

    await page.getByRole("button", { name: "More actions" }).first().click();
    await page.getByRole("menuitem", { name: "Add to Playlist" }).click();
    await page.getByRole("button", { name: "New playlist" }).click();
    const playlistNameInput = page.getByPlaceholder("Playlist name");
    await playlistNameInput.fill("From Library");
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/resources/create-playlist-with-track") && response.ok(),
      ),
      playlistNameInput.press("Enter"),
    ]);

    await expect
      .poll(async () => {
        const result = await prisma.userPlaylist.findFirst({
          where: { ownerId: user.id, title: "From Library" },
        });
        return result?.id ?? "";
      })
      .not.toBe("");

    const playlist = await prisma.userPlaylist.findFirst({
      where: { ownerId: user.id, title: "From Library" },
      include: { tracks: true },
    });

    expect(playlist).not.toBeNull();
    if (!playlist) return;

    expect(playlist.tracks).toHaveLength(1);
    expect(playlist.tracks[0]?.trackId).toBe(track.id);

    await prisma.userPlaylistTrack.deleteMany({ where: { playlistId: playlist.id } });
    await prisma.userPlaylist.delete({ where: { id: playlist.id } });
  });

  test("rejects duplicate playlist name inline from library track row", async ({
    page,
    login,
    insertNewTrack,
  }) => {
    const user = await login();
    await insertNewTrack({}, user.id);

    const existing = await prisma.userPlaylist.create({
      data: {
        title: "Road Trip",
        ownerId: user.id,
      },
    });

    await page.goto("/library");
    await page.waitForLoadState("domcontentloaded");

    await page.getByRole("button", { name: "More actions" }).first().click();
    await page.getByRole("menuitem", { name: "Add to Playlist" }).click();
    await page.getByRole("button", { name: "New playlist" }).click();
    const playlistNameInput = page.getByPlaceholder("Playlist name");
    await playlistNameInput.fill("road trip");
    await playlistNameInput.press("Enter");

    await expect(page.getByTestId("toast")).toContainText(/already have a playlist named/i, {
      timeout: 10000,
    });
    await expect(page).toHaveURL("/library");

    await prisma.userPlaylist.delete({ where: { id: existing.id } });
  });

  test("filters library list to only tracks with audio", async ({
    page,
    login,
    insertNewTrack,
  }) => {
    test.setTimeout(60_000);
    const user = await login();

    await insertNewTrack({ title: "Metadata Only Track" }, user.id);
    const playable = await insertNewTrack({ title: "Playable Filter Track" }, user.id);

    await testPrisma.trackAudioFile.create({
      data: {
        trackId: playable.id,
        objectKey: "audio/test-filter.mp3",
        format: "mp3",
        mimeType: "audio/mpeg",
      },
    });

    await page.goto("/library", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("Metadata Only Track")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Playable Filter Track")).toBeVisible({ timeout: 10000 });

    await page.getByLabel("Only tracks with audio").click();
    await expect(page).toHaveURL(/hasAudio=1/);
    await expect(page.getByText("Playable Filter Track")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Metadata Only Track")).not.toBeVisible();

    await page.getByLabel("Only tracks with audio").click();
    await expect(page).not.toHaveURL(/hasAudio=1/);
    await expect(page.getByText("Metadata Only Track")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Playable Filter Track")).toBeVisible({ timeout: 10000 });
  });

  test("curator opens the metadata editor from the library row on desktop without playing", async ({
    page,
    login,
    insertNewTrack,
  }) => {
    test.setTimeout(45_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    const user = await login({ roles: ["curator", "user"] });
    const track = await insertNewTrack({ title: "Curator Editor Track" }, user.id);
    await testPrisma.trackAudioFile.create({
      data: {
        trackId: track.id,
        objectKey: `audio/${track.id}.mp3`,
        format: "mp3",
        mimeType: "audio/mpeg",
      },
    });

    await page.goto("/library");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("Curator Editor Track").first()).toBeVisible({ timeout: 10000 });
    await dismissOverlays(page);
    expect(page.viewportSize()).toEqual({ width: 1280, height: 800 });

    const detailsResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/resources/track-details") &&
        response.url().includes(track.id) &&
        response.ok(),
    );
    await page.getByRole("button", { name: "More actions" }).first().click();
    await page.getByRole("menuitem", { name: "View track details" }).click();
    await detailsResponse;

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("tab", { name: "Basic" })).toBeVisible();
    await expect(dialog.getByRole("tab", { name: "Extended" })).toBeVisible();
    await expect(dialog.getByRole("tab", { name: "History" })).toBeVisible();
    await expect(dialog.getByRole("tab", { name: "Notes" })).toBeVisible();
    await expect(page.getByTestId("player-desktop-bar")).toHaveCount(0);
    await expect(page.getByTestId("player-mini-bar")).toHaveCount(0);
    expect(page.viewportSize()).toEqual({ width: 1280, height: 800 });

    await dialog.getByRole("tab", { name: "Extended" }).click();
    await expect(dialog.getByRole("tab", { name: "Extended" })).toHaveAttribute(
      "data-state",
      "active",
    );
    await expect(page.getByTestId("player-desktop-bar")).toHaveCount(0);
  });

  test("admin opens the metadata editor from the library row on mobile without playing", async ({
    page,
    loginAsAdmin,
    insertNewTrack,
  }) => {
    test.setTimeout(45_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const user = await loginAsAdmin();
    const track = await insertNewTrack({ title: "Admin Mobile Editor Track" }, user.id);
    await testPrisma.trackAudioFile.create({
      data: {
        trackId: track.id,
        objectKey: `audio/${track.id}.mp3`,
        format: "mp3",
        mimeType: "audio/mpeg",
      },
    });

    await page.goto("/library");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("Admin Mobile Editor Track").first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page).toHaveURL(/\/library/);
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();

    // useIsMobile starts false so the first paint is the desktop menu. Wait until
    // the row has switched to the mobile sheet before opening track details.
    await expect(async () => {
      await page.getByRole("button", { name: "More actions" }).first().click();
      await expect(page.getByRole("button", { name: "View track details" })).toBeVisible({
        timeout: 1500,
      });
    }).toPass({ timeout: 10000 });

    const detailsResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/resources/track-details") &&
        response.url().includes(track.id) &&
        response.ok(),
    );
    await page.getByRole("button", { name: "View track details" }).click();
    await detailsResponse;

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("tab", { name: "Basic" })).toBeVisible();
    await expect(dialog.getByRole("tab", { name: "Extended" })).toBeVisible();
    await expect(dialog.getByRole("tab", { name: "History" })).toBeVisible();
    await expect(dialog.getByRole("tab", { name: "Notes" })).toBeVisible();
    await expect(page.getByText("Track Information")).toHaveCount(0);
    await expect(page.getByTestId("player-desktop-bar")).toHaveCount(0);
    await expect(page.getByTestId("player-mini-bar")).toHaveCount(0);
  });

  test("non-curator library row keeps the read-only track details view", async ({
    page,
    login,
    insertNewTrack,
  }) => {
    test.setTimeout(45_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    const user = await login();
    await insertNewTrack({ title: "Read Only Details Track" }, user.id);

    await page.goto("/library");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("Read Only Details Track").first()).toBeVisible({
      timeout: 10000,
    });
    await dismissOverlays(page);

    let requestedDetails = false;
    page.on("request", (request) => {
      if (request.url().includes("/resources/track-details")) requestedDetails = true;
    });

    await page.getByRole("button", { name: "More actions" }).first().click();
    await page.getByRole("menuitem", { name: "View track details" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Track Information")).toBeVisible();
    await expect(dialog.getByText(/Artist: Test Artist/)).toBeVisible();
    await expect(dialog.getByText(/Duration:/)).toBeVisible();
    await expect(dialog.getByText(/Added:/)).toHaveCount(0);
    await expect(dialog.getByRole("tab", { name: "Basic" })).toHaveCount(0);
    expect(requestedDetails).toBe(false);
  });

  test("playing from library shows upcoming tracks in the queue sheet", async ({
    page,
    login,
    insertNewTrack,
  }) => {
    test.setTimeout(60_000);
    const user = await login();
    const firstTrack = await insertNewTrack({ title: "Queue Alpha" }, user.id);
    const secondTrack = await insertNewTrack({ title: "Queue Beta" }, user.id);

    for (const track of [firstTrack, secondTrack]) {
      await testPrisma.trackAudioFile.create({
        data: {
          trackId: track.id,
          objectKey: `audio/${track.id}.mp3`,
          format: "mp3",
          mimeType: "audio/mpeg",
        },
      });
    }

    await page.goto("/library");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByRole("heading", { name: /music library/i })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("Queue Alpha").first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Queue Beta").first()).toBeVisible({ timeout: 10000 });

    await Promise.all([
      page.waitForResponse(
        (response) => response.url().includes("/api/queue-spine") && response.status() === 200,
        { timeout: 15000 },
      ),
      page.getByRole("gridcell", { name: /Queue Beta by Test Artist/i }).click(),
    ]);

    const playerBar = page.getByTestId("player-desktop-bar");
    await expect(playerBar).toBeVisible({ timeout: 10000 });
    await expect(playerBar.getByText("Queue Beta")).toBeVisible();

    const installBanner = page.getByRole("region", { name: "Install app" });
    if (await installBanner.isVisible().catch(() => false)) {
      await page.getByRole("button", { name: "Not now" }).click();
    }

    await playerBar.getByLabel("Open queue").click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Now playing" })).toBeVisible();
    await expect(dialog.getByText("Queue Beta")).toBeVisible();
    await expect(dialog.getByText("Queue Alpha")).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Queue (2 from library)" })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "From Library", exact: true })).toBeVisible();
  });
});
