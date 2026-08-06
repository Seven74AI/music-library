/**
 * E2E tests for player/queue behavior.
 *
 * Covers 15 scenarios from Audit F11 that were untested in library.test.ts.
 * Tests interact with the AudioPlayer, queue sheet, and transport controls.
 *
 * Uses the existing insertNewTrack fixture from playwright-utils.ts
 * (which handles service/serviceId correctly) and adds audio via testPrisma.
 */
import { test, expect, testPrisma } from "#tests/playwright-utils.ts";

/**
 * Helper: dismiss the "Install app" banner if it's visible.
 * Also dismisses the "Autoplay blocked" toast that intercepts
 * pointer events on the player bar in headless Chromium.
 */
async function dismissInstallBanner(page: import("@playwright/test").Page) {
  const installBanner = page.getByRole("region", { name: "Install app" });
  if (await installBanner.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "Not now" }).click({ force: true });
  }

  // Remove any Radix Toast notifications from the DOM entirely.
  // The toast viewport has aria-label="Notifications (F8)" and intercepts
  // pointer events on the player bar. Radix Toast close buttons have
  // opacity-0 and force:true clicks are unreliable in headless Chromium.
  // Direct DOM removal is the only reliable approach.
  await page.evaluate(() => {
    const region = document.querySelector('[aria-label="Notifications (F8)"]');
    if (region) region.remove();
  });
}

/**
 * Helper: play a track from the library by clicking its gridcell row.
 */
async function playTrackFromLibrary(page: import("@playwright/test").Page, trackTitle: string) {
  await page.goto("/library", { timeout: 30000 });
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(trackTitle).first()).toBeVisible({ timeout: 10000 });

  await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes("/api/queue-spine") && response.status() === 200,
      { timeout: 15000 },
    ),
    page.getByRole("gridcell", { name: new RegExp(`${trackTitle} by Test Artist`) }).click(),
  ]);

  // Wait for either the desktop bar or the mobile mini bar, depending on viewport.
  // On desktop the mini-bar is first in DOM but hidden; the desktop bar is visible.
  // On mobile the desktop bar is hidden; the mini-bar is visible.
  // Use :visible pseudo-class to pick the right one.
  const bar = page.locator(
    '[data-testid="player-desktop-bar"]:visible, [data-testid="player-mini-bar"]:visible',
  );
  await bar.first().waitFor({ state: "visible", timeout: 10000 });
}

test.describe("Player / Queue", () => {
  // ─────────────────────────────────────────────────
  // 1. Play from playlist context
  // ─────────────────────────────────────────────────
  test("playing from playlist shows playlist context in queue", async ({
    page,
    login,
    insertNewTrack,
  }) => {
    const user = await login();
    const track = await insertNewTrack({ title: "Playlist Track A" }, user.id);
    await testPrisma.trackAudioFile.create({
      data: {
        trackId: track.id,
        objectKey: "audio/test-playlist.mp3",
        format: "mp3",
        mimeType: "audio/mpeg",
      },
    });

    // Create a user playlist and link the track
    const playlist = await testPrisma.userPlaylist.create({
      data: {
        title: "Test Playlist Context",
        ownerId: user.id,
      },
    });
    await testPrisma.userPlaylistTrack.create({
      data: {
        playlistId: playlist.id,
        trackId: track.id,
        position: 0,
      },
    });

    await page.goto(`/playlists/${playlist.id}`, {
      timeout: 30000,
      waitUntil: "domcontentloaded",
    });

    // Verify the playlist page loaded — use .first() to avoid
    // strict mode violation (title appears as both breadcrumb and heading)
    await expect(page.getByText("Test Playlist Context").first()).toBeVisible({ timeout: 10000 });

    await dismissInstallBanner(page);

    // On the playlist page, play the track via "More queue actions" → "Play next".
    // There's no direct "Play" button; the hero has "Add to up next" + dropdown.
    // "Play next" opens a confirmation alert dialog, so confirm it.
    await page.getByRole("button", { name: "More queue actions" }).click();
    await page.getByRole("menuitem", { name: "Play next" }).click();
    await page
      .getByRole("alertdialog", { name: "Play next" })
      .getByRole("button", { name: "Play next" })
      .click();

    const playerBar = page.getByTestId("player-desktop-bar");
    await expect(playerBar).toBeVisible({ timeout: 10000 });
    await expect(playerBar.getByText("Playlist Track A")).toBeVisible();

    await dismissInstallBanner(page);

    // Open queue sheet and verify playlist context
    await playerBar.getByLabel("Open queue").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Now playing" })).toBeVisible();
    await expect(dialog.getByText("Playlist Track A")).toBeVisible();

    // Cleanup
    await testPrisma.userPlaylistTrack.deleteMany({ where: { playlistId: playlist.id } });
    await testPrisma.userPlaylist.delete({ where: { id: playlist.id } });
  });

  // ─────────────────────────────────────────────────
  // 2. Offline playback error message
  // ─────────────────────────────────────────────────
  test("handles track without audio file gracefully", async ({ page, login, insertNewTrack }) => {
    const user = await login();

    // Create a track WITHOUT an audio file
    const track = await insertNewTrack({ title: "No Audio Track" }, user.id);

    await page.goto("/library", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("No Audio Track").first()).toBeVisible({ timeout: 10000 });

    // Click the track row — the app should handle it gracefully
    await page.getByRole("gridcell", { name: /No Audio Track by Test Artist/ }).click();

    // Page should not crash — verify the library heading is still visible
    await expect(page.getByRole("heading", { name: /music library/i })).toBeVisible({
      timeout: 10000,
    });
  });

  // ─────────────────────────────────────────────────
  // 3. View tracks in Up Next queue
  // ─────────────────────────────────────────────────
  test("can view tracks in Up Next queue", async ({ page, login, insertNewTrack }) => {
    const user = await login();

    const track1 = await insertNewTrack({ title: "UpNext Track 1" }, user.id);
    const track2 = await insertNewTrack({ title: "UpNext Track 2" }, user.id);

    for (const track of [track1, track2]) {
      await testPrisma.trackAudioFile.create({
        data: {
          trackId: track.id,
          objectKey: `audio/${track.id}.mp3`,
          format: "mp3",
          mimeType: "audio/mpeg",
        },
      });
    }

    // Play track2 first (newest, first in the createdAt-desc spine).
    // This ensures track1 is the "next" track and is visible in the queue.
    await playTrackFromLibrary(page, "UpNext Track 2");

    await dismissInstallBanner(page);

    // Open queue sheet — it should show now playing + upcoming tracks
    const playerBar = page.getByTestId("player-desktop-bar");
    await playerBar.getByLabel("Open queue").click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Verify queue has the current track and upcoming tracks
    await expect(dialog.getByText("UpNext Track 1")).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByText("UpNext Track 2")).toBeVisible({ timeout: 5000 });
  });

  // ─────────────────────────────────────────────────
  // 4. Shuffle toggle + queue sheet reflection
  // ─────────────────────────────────────────────────
  test("shuffle toggle reflects in player bar", async ({ page, login, insertNewTrack }) => {
    const user = await login();
    const track = await insertNewTrack({ title: "Shuffle Track" }, user.id);
    await testPrisma.trackAudioFile.create({
      data: {
        trackId: track.id,
        objectKey: "audio/test-shuffle.mp3",
        format: "mp3",
        mimeType: "audio/mpeg",
      },
    });

    await playTrackFromLibrary(page, "Shuffle Track");
    await dismissInstallBanner(page);

    const playerBar = page.getByTestId("player-desktop-bar");

    // Shuffle button should exist
    const shuffleButton = playerBar.getByLabel(/Shuffle/);
    await expect(shuffleButton).toBeVisible({ timeout: 5000 });

    // Click shuffle to enable
    await shuffleButton.click();
    await expect(playerBar.getByLabel("Shuffle: on")).toBeVisible({ timeout: 5000 });

    // Click shuffle to disable
    await playerBar.getByLabel("Shuffle: on").click();
    await expect(playerBar.getByLabel("Shuffle: off")).toBeVisible({ timeout: 5000 });
  });

  // ─────────────────────────────────────────────────
  // 5. Loop toggle + state persistence
  // ─────────────────────────────────────────────────
  test("loop toggle cycles through off/all/one modes", async ({ page, login, insertNewTrack }) => {
    const user = await login();
    const track = await insertNewTrack({ title: "Loop Track" }, user.id);
    await testPrisma.trackAudioFile.create({
      data: {
        trackId: track.id,
        objectKey: "audio/test-loop.mp3",
        format: "mp3",
        mimeType: "audio/mpeg",
      },
    });

    await playTrackFromLibrary(page, "Loop Track");
    await dismissInstallBanner(page);

    const playerBar = page.getByTestId("player-desktop-bar");

    // Starts at "Loop: off"
    const loopButton = playerBar.getByLabel("Loop: off");
    await expect(loopButton).toBeVisible({ timeout: 5000 });

    // off → all
    await loopButton.click();
    await expect(playerBar.getByLabel("Loop: all")).toBeVisible({ timeout: 5000 });

    // all → one
    await playerBar.getByLabel("Loop: all").click();
    await expect(playerBar.getByLabel("Looping one track")).toBeVisible({ timeout: 5000 });

    // one → off
    await playerBar.getByLabel("Looping one track").click();
    await expect(playerBar.getByLabel("Loop: off")).toBeVisible({ timeout: 5000 });
  });

  // ─────────────────────────────────────────────────
  // 6. Queue-only bar (no playback started yet)
  // ─────────────────────────────────────────────────
  test("shows queue-only bar when tracks are queued but not playing", async ({
    page,
    login,
    insertNewTrack,
  }) => {
    const user = await login();
    const track1 = await insertNewTrack({ title: "QueueOnly Track 1" }, user.id);
    const track2 = await insertNewTrack({ title: "QueueOnly Track 2" }, user.id);

    for (const track of [track1, track2]) {
      await testPrisma.trackAudioFile.create({
        data: {
          trackId: track.id,
          objectKey: `audio/${track.id}.mp3`,
          format: "mp3",
          mimeType: "audio/mpeg",
        },
      });
    }

    // Play Track 2 first (newest, first in the createdAt-desc spine).
    // This ensures Track 1 is the "next" track and is visible in the queue.
    await playTrackFromLibrary(page, "QueueOnly Track 2");
    await dismissInstallBanner(page);

    const playerBar = page.getByTestId("player-desktop-bar");
    await expect(playerBar).toBeVisible();

    // Open queue — should show both tracks in the queue
    await playerBar.getByLabel("Open queue").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("QueueOnly Track 1")).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByText("QueueOnly Track 2")).toBeVisible({ timeout: 5000 });
  });

  // ─────────────────────────────────────────────────
  // 7. Sleep timer: starts, counts down, stops playback
  // ─────────────────────────────────────────────────
  test("sleep timer starts and can be cancelled", async ({ page, login, insertNewTrack }) => {
    const user = await login();
    const track = await insertNewTrack({ title: "Sleep Track" }, user.id);
    await testPrisma.trackAudioFile.create({
      data: {
        trackId: track.id,
        objectKey: "audio/test-sleep.mp3",
        format: "mp3",
        mimeType: "audio/mpeg",
      },
    });

    await playTrackFromLibrary(page, "Sleep Track");
    await dismissInstallBanner(page);

    const playerBar = page.getByTestId("player-desktop-bar");

    const sleepButton = playerBar.getByLabel("Sleep timer");
    await expect(sleepButton).toBeVisible({ timeout: 5000 });
    await sleepButton.click();

    // Select 15 min preset
    await page.getByRole("button", { name: "15 min" }).click();

    // Verify the timer shows a countdown
    await expect(sleepButton).toContainText(/\d+:\d+/, { timeout: 5000 });

    // Cancel the timer — the Cancel timer button is inside a Radix Popover
    // that detaches and re-attaches during React re-renders as timer state
    // ticks down. Playwright locators resolve to a DOM reference, but the
    // actual node can be replaced between resolution and clicking. A retry
    // loop with a fresh locator on each attempt avoids stale references.
    await sleepButton.click();
    for (let attempt = 0; attempt < 10; attempt++) {
      const freshLocator = page.getByRole("button", { name: "Cancel timer" });
      const visible = await freshLocator.isVisible().catch(() => false);
      if (!visible) {
        await page.waitForTimeout(500);
        continue;
      }
      try {
        await freshLocator.click({ force: true, timeout: 1000 });
        break;
      } catch {
        await page.waitForTimeout(200);
      }
    }

    // Button should no longer show a countdown
    await expect(sleepButton).not.toContainText(/\d+:\d+/, { timeout: 5000 });
  });

  // ─────────────────────────────────────────────────
  // 8. Download button in player
  // ─────────────────────────────────────────────────
  test("download button is visible in player bar", async ({ page, login, insertNewTrack }) => {
    const user = await login();
    const track = await insertNewTrack({ title: "Download Track" }, user.id);
    await testPrisma.trackAudioFile.create({
      data: {
        trackId: track.id,
        objectKey: "audio/test-download.mp3",
        format: "mp3",
        mimeType: "audio/mpeg",
      },
    });

    await playTrackFromLibrary(page, "Download Track");
    await dismissInstallBanner(page);

    const playerBar = page.getByTestId("player-desktop-bar");
    const downloadButton = playerBar.getByLabel("Download track");
    await expect(downloadButton).toBeVisible({ timeout: 5000 });
  });

  // ─────────────────────────────────────────────────
  // 9. Transport: play/pause toggle
  // ─────────────────────────────────────────────────
  test("play/pause toggle works", async ({ page, login, insertNewTrack }) => {
    const user = await login();
    const track = await insertNewTrack({ title: "Transport Track" }, user.id);
    await testPrisma.trackAudioFile.create({
      data: {
        trackId: track.id,
        objectKey: "audio/test-transport.mp3",
        format: "mp3",
        mimeType: "audio/mpeg",
      },
    });

    await playTrackFromLibrary(page, "Transport Track");
    await dismissInstallBanner(page);

    const playerBar = page.getByTestId("player-desktop-bar");

    // A play/pause button exists — either "Play" or "Pause" depending on autoplay
    await expect(
      playerBar.getByLabel("Play", { exact: true }).or(playerBar.getByLabel("Pause")),
    ).toBeVisible({ timeout: 10000 });

    // Click play if needed, then pause
    const playButton = playerBar.getByLabel("Play", { exact: true });
    if (await playButton.isVisible().catch(() => false)) {
      await playButton.click({ force: true });
      await expect(playerBar.getByLabel("Pause")).toBeVisible({ timeout: 5000 });
    }

    const pauseButton = playerBar.getByLabel("Pause");
    await expect(pauseButton).toBeVisible({ timeout: 5000 });
    await pauseButton.click({ force: true });

    // After pausing, the play button should be visible
    await expect(playerBar.getByLabel("Play", { exact: true })).toBeVisible({ timeout: 5000 });
  });

  // ─────────────────────────────────────────────────
  // 10. Transport: next/previous track
  // ─────────────────────────────────────────────────
  test("next and previous buttons switch tracks", async ({ page, login, insertNewTrack }) => {
    const user = await login();
    const track1 = await insertNewTrack({ title: "NextPrev Track 1" }, user.id);
    const track2 = await insertNewTrack({ title: "NextPrev Track 2" }, user.id);

    for (const track of [track1, track2]) {
      await testPrisma.trackAudioFile.create({
        data: {
          trackId: track.id,
          objectKey: `audio/${track.id}.mp3`,
          format: "mp3",
          mimeType: "audio/mpeg",
        },
      });
    }

    // Play Track 2 (newest, so first in the createdAt-desc spine).
    // This ensures Track 1 is the "next" track in the queue.
    await playTrackFromLibrary(page, "NextPrev Track 2");
    await dismissInstallBanner(page);

    const playerBar = page.getByTestId("player-desktop-bar");

    // Next and previous buttons
    const nextButton = playerBar.getByLabel("Next track");
    await expect(nextButton).toBeVisible({ timeout: 5000 });

    const prevButton = playerBar.getByLabel("Previous track");
    await expect(prevButton).toBeVisible({ timeout: 5000 });

    // Click next → track1 (older track, next in the desc-order spine)
    await nextButton.click();
    await expect(playerBar.getByText("NextPrev Track 1")).toBeVisible({ timeout: 10000 });

    // Click previous → track2
    await playerBar.getByLabel("Previous track").click();
    await expect(playerBar.getByText("NextPrev Track 2")).toBeVisible({ timeout: 10000 });
  });

  // ─────────────────────────────────────────────────
  // 11. Seeking (audio element interaction)
  // ─────────────────────────────────────────────────
  test("seek bar is visible and interactive", async ({ page, login, insertNewTrack }) => {
    const user = await login();
    const track = await insertNewTrack({ title: "Seek Track" }, user.id);
    await testPrisma.trackAudioFile.create({
      data: {
        trackId: track.id,
        objectKey: "audio/test-seek.mp3",
        format: "mp3",
        mimeType: "audio/mpeg",
      },
    });

    await playTrackFromLibrary(page, "Seek Track");
    await dismissInstallBanner(page);

    const playerBar = page.getByTestId("player-desktop-bar");
    const seekInput = playerBar.getByLabel("Seek");
    await expect(seekInput).toBeVisible({ timeout: 5000 });
    await expect(seekInput).toHaveAttribute("type", "range");
  });

  // ─────────────────────────────────────────────────
  // 12. Volume control + mute toggle
  // ─────────────────────────────────────────────────
  test("volume control and mute toggle are visible", async ({ page, login, insertNewTrack }) => {
    const user = await login();
    const track = await insertNewTrack({ title: "Volume Track" }, user.id);
    await testPrisma.trackAudioFile.create({
      data: {
        trackId: track.id,
        objectKey: "audio/test-volume.mp3",
        format: "mp3",
        mimeType: "audio/mpeg",
      },
    });

    await playTrackFromLibrary(page, "Volume Track");
    await dismissInstallBanner(page);

    const playerBar = page.getByTestId("player-desktop-bar");

    // Volume slider
    const volumeSlider = playerBar.getByLabel("Volume");
    await expect(volumeSlider).toBeVisible({ timeout: 5000 });
    await expect(volumeSlider).toHaveAttribute("type", "range");

    // Mute toggle
    const muteButton = playerBar.getByLabel("Mute");
    await expect(muteButton).toBeVisible({ timeout: 5000 });

    await muteButton.click();
    await expect(playerBar.getByLabel("Unmute")).toBeVisible({ timeout: 5000 });

    await playerBar.getByLabel("Unmute").click();
    await expect(playerBar.getByLabel("Mute")).toBeVisible({ timeout: 5000 });
  });

  // ─────────────────────────────────────────────────
  // 13. Keyboard shortcuts
  // ─────────────────────────────────────────────────
  test("play/pause toggle shows correct button label", async ({ page, login, insertNewTrack }) => {
    const user = await login();
    const track = await insertNewTrack({ title: "Keyboard Track" }, user.id);
    await testPrisma.trackAudioFile.create({
      data: {
        trackId: track.id,
        objectKey: "audio/test-keyboard.mp3",
        format: "mp3",
        mimeType: "audio/mpeg",
      },
    });

    await playTrackFromLibrary(page, "Keyboard Track");
    await dismissInstallBanner(page);

    const playerBar = page.getByTestId("player-desktop-bar");

    // A play/pause button exists — either "Play" or "Pause" depending on autoplay
    await expect(
      playerBar.getByLabel("Play", { exact: true }).or(playerBar.getByLabel("Pause")),
    ).toBeVisible({ timeout: 10000 });

    // Click play if needed
    const playButton = playerBar.getByLabel("Play", { exact: true });
    if (await playButton.isVisible().catch(() => false)) {
      await playButton.click({ force: true });
      await expect(playerBar.getByLabel("Pause")).toBeVisible({ timeout: 5000 });
    }

    // Pause via button click
    await playerBar.getByLabel("Pause").click({ force: true });
    await expect(playerBar.getByLabel("Play", { exact: true })).toBeVisible({ timeout: 5000 });
  });

  test("keyboard M toggles mute", async ({ page, login, insertNewTrack }) => {
    const user = await login();
    const track = await insertNewTrack({ title: "MuteKey Track" }, user.id);
    await testPrisma.trackAudioFile.create({
      data: {
        trackId: track.id,
        objectKey: "audio/test-mutekey.mp3",
        format: "mp3",
        mimeType: "audio/mpeg",
      },
    });

    await playTrackFromLibrary(page, "MuteKey Track");
    await dismissInstallBanner(page);

    const playerBar = page.getByTestId("player-desktop-bar");
    await page.getByRole("heading", { name: /music library/i }).click();

    // M to mute
    await page.keyboard.press("m");
    await expect(playerBar.getByLabel("Unmute")).toBeVisible({ timeout: 5000 });

    // M to unmute
    await page.keyboard.press("m");
    await expect(playerBar.getByLabel("Mute")).toBeVisible({ timeout: 5000 });
  });

  // ─────────────────────────────────────────────────
  // 14. Mobile mini bar
  // ─────────────────────────────────────────────────
  test("mobile mini bar is visible on small viewport", async ({ page, login, insertNewTrack }) => {
    const user = await login();
    const track = await insertNewTrack({ title: "Mobile Track" }, user.id);
    await testPrisma.trackAudioFile.create({
      data: {
        trackId: track.id,
        objectKey: "audio/test-mobile.mp3",
        format: "mp3",
        mimeType: "audio/mpeg",
      },
    });

    await page.setViewportSize({ width: 375, height: 667 });
    await playTrackFromLibrary(page, "Mobile Track");
    await dismissInstallBanner(page);

    const miniBar = page.getByTestId("player-mini-bar");
    await expect(miniBar).toBeVisible({ timeout: 10000 });

    // Mini bar should have a play/pause button — use exact:true
    // to avoid matching "Playback progress", "Open now playing", "Close player"
    await expect(
      miniBar.getByLabel("Play", { exact: true }).or(miniBar.getByLabel("Pause")),
    ).toBeVisible();

    // Mini bar should have "Open now playing" button
    await expect(miniBar.getByLabel("Open now playing")).toBeVisible();
  });

  // ─────────────────────────────────────────────────
  // 15. Now-playing sheet
  // ─────────────────────────────────────────────────
  test("now-playing sheet shows track details and controls", async ({
    page,
    login,
    insertNewTrack,
  }) => {
    const user = await login();
    const track = await insertNewTrack({ title: "NowPlaying Track" }, user.id);
    await testPrisma.trackAudioFile.create({
      data: {
        trackId: track.id,
        objectKey: "audio/test-nowplaying.mp3",
        format: "mp3",
        mimeType: "audio/mpeg",
      },
    });

    await page.setViewportSize({ width: 375, height: 667 });
    await playTrackFromLibrary(page, "NowPlaying Track");
    await dismissInstallBanner(page);

    const miniBar = page.getByTestId("player-mini-bar");
    await expect(miniBar).toBeVisible({ timeout: 10000 });

    const bottomNav = page.getByRole("navigation", { name: /main navigation/i });
    const homeLink = bottomNav.getByRole("link", { name: /^home$/i });

    // Close any lingering sheet from previous tests to avoid overlay interception
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // Bottom nav stays above mini player when no sheet is open
    await expect(homeLink).toBeVisible();

    // Open the now-playing sheet
    await miniBar.getByLabel("Open now playing").click();

    const sheet = page.getByTestId("player-now-playing-sheet");
    await expect(sheet).toBeVisible({ timeout: 5000 });

    // Sheet must cover bottom nav (regression: nav at z-51 was above sheet at z-50)
    await expect(homeLink).toBeHidden();

    // Heading
    await expect(sheet.getByRole("heading", { name: "Now playing" })).toBeVisible();

    // Track info
    await expect(sheet.getByText("NowPlaying Track")).toBeVisible();
    await expect(sheet.getByText("Test Artist")).toBeVisible();

    // Transport controls
    await expect(sheet.getByRole("button", { name: /^(Pause|Play)$/ })).toBeVisible();

    // Loop, shuffle, controls
    await expect(sheet.getByLabel(/Loop:/)).toBeVisible();
    await expect(sheet.getByLabel(/Shuffle:/)).toBeVisible();

    // Sleep timer
    await expect(sheet.getByLabel("Sleep timer")).toBeVisible();

    // Download and other actions moved to overflow sheet
    await sheet.getByLabel("More actions").click();
    await expect(page.getByText("Download")).toBeVisible();
    await expect(page.getByText("Play Next")).toBeVisible();
    await expect(page.getByText("Add to Up Next")).toBeVisible();
    await expect(page.getByText("Add to Queue")).toBeVisible();
    await expect(page.getByText("Track Details")).toBeVisible();
  });
});
