import { dismissOverlays, test, expect, testPrisma } from "#tests/playwright-utils.ts";

async function openDashboard(page: import("@playwright/test").Page) {
  await page.goto("/music/curator/dashboard", { waitUntil: "load", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await dismissOverlays(page);
}

test.describe("Curator dashboard", () => {
  test.describe.configure({ mode: "serial", timeout: 45_000 });

  test("loads every tab", async ({ page, loginAsAdmin }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAsAdmin();
    await openDashboard(page);

    await expect(page.getByRole("heading", { name: "Curator dashboard" })).toBeVisible();
    await expect(page.getByTestId("metric-total-tracks")).toBeVisible();
    await expect(page.getByTestId("leaderboard")).toBeVisible();
    await expect(page.getByTestId("activity-feed")).toBeVisible();

    await page.getByRole("tab", { name: "Queue" }).click();
    await expect(page.getByRole("heading", { name: "Review queue" })).toBeVisible();
    await expect(page.getByTestId("queue-table")).toBeVisible();
    await expect(page.getByLabel("Status")).toBeVisible();

    await page.getByRole("tab", { name: "Reports" }).click();
    await expect(page.getByRole("heading", { name: "Metadata completeness" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Edits per day" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Issue types" })).toBeVisible();
    await expect(page.getByTestId("completeness-chart").locator("svg").first()).toBeVisible();

    await page.getByRole("tab", { name: "Activity" }).click();
    await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Curator" })).toBeVisible();
    await expect(page.getByLabel("Entity type")).toBeVisible();
    await expect(page.getByLabel("From")).toBeVisible();

    await page.setViewportSize({ width: 390, height: 800 });
    await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible();
    await page.getByRole("tab", { name: "Overview" }).click();
    await expect(page.getByTestId("metric-completeness")).toBeVisible();
  });

  test("refreshes metrics from the database", async ({ page, loginAsAdmin, insertNewTrack }) => {
    await loginAsAdmin();
    await openDashboard(page);
    const total = page.getByTestId("metric-total-tracks");
    await expect(total).toBeVisible();

    await insertNewTrack({ title: `Dashboard refresh ${Date.now()}` });
    await page.getByRole("button", { name: "Refresh" }).click();
    const expected = String(await testPrisma.track.count());
    await expect(total).toHaveAttribute("data-count", expected);
  });

  test("shows the curator on the weekly leaderboard", async ({
    page,
    loginAsAdmin,
    insertNewTrack,
  }) => {
    const user = await loginAsAdmin();
    const track = await insertNewTrack({ title: `Leaderboard ${Date.now()}` });
    const row = await testPrisma.track.findUniqueOrThrow({ where: { id: track.id } });
    await testPrisma.trackEdit.create({
      data: {
        trackId: track.id,
        editedBy: user.id,
        title: track.title,
        artistId: row.artistId,
      },
    });

    await openDashboard(page);
    const board = page.getByTestId("leaderboard");
    await expect(board).toContainText(user.name ?? user.username);
  });

  test("activity feed picks up a new edit", async ({ page, loginAsAdmin, insertNewTrack }) => {
    const user = await loginAsAdmin();
    await openDashboard(page);
    await expect(page.getByTestId("activity-feed")).toBeVisible();

    const track = await insertNewTrack({ title: `Feed ${Date.now()}` });
    const row = await testPrisma.track.findUniqueOrThrow({ where: { id: track.id } });
    await testPrisma.trackEdit.create({
      data: {
        trackId: track.id,
        editedBy: user.id,
        title: track.title,
        artistId: row.artistId,
        editedAt: new Date(),
      },
    });

    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByTestId("activity-feed")).toContainText(track.title);
  });

  test("blocks listeners", async ({ page, login }) => {
    await login();
    await page.goto("/music/curator/dashboard", { waitUntil: "load", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    await expect(page.getByRole("heading", { name: "Curators only" })).toBeVisible();
  });
});
