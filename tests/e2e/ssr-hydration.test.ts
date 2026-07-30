import type { Page } from "@playwright/test";
import { test, expect } from "#tests/playwright-utils.ts";

/**
 * SSR hydration smoke tests — catch unguarded `navigator.*` calls that return
 * `undefined` on Node ≥21 and corrupt the SSR output.
 *
 * Each test: login → navigate → reload → assert no offline UI or hydration errors.
 */
test.describe("SSR hydration", () => {
  // ── Helpers ──────────────────────────────────────────────────────────────

  async function assertHydrationClean(
    page: Page,
    { routeSpecific }: { routeSpecific?: () => Promise<void> } = {},
  ) {
    // Offline banner must never appear in SSR'd HTML
    await expect(page.getByText("You're offline")).not.toBeAttached({
      timeout: 5000,
    });
    // Core app shell must be present (not an error boundary or blank page).
    // BottomNav has md:hidden — not visible on desktop. Use <header> instead.
    await expect(page.locator("header")).toBeAttached({ timeout: 5000 });
    if (routeSpecific) await routeSpecific();
  }

  function collectErrors(page: Page) {
    const errors: string[] = [];
    page.on("pageerror", (err: Error) => errors.push(err.message));
    return errors;
  }

  async function loginReloadAndCheck(
    page: Page,
    login: () => Promise<unknown>,
    path: string,
    opts?: { routeSpecific?: () => Promise<void> },
  ) {
    const errors = collectErrors(page);
    await login();
    await page.goto(path, { timeout: 30000, waitUntil: "load" });
    await page.reload({ timeout: 30000, waitUntil: "load" });
    await assertHydrationClean(page, opts);

    const hydrationErrors = errors.filter(
      (e) => e.includes("No result found") || e.includes("SingleFetch"),
    );
    expect(hydrationErrors).toEqual([]);
  }

  // ── Route smoke tests ───────────────────────────────────────────────────

  const LOGGED_IN_ROUTES = [
    { path: "/", name: "home" },
    { path: "/library", name: "library" },
    { path: "/playlists", name: "playlists" },
    { path: "/search", name: "search" },
    { path: "/downloads", name: "downloads" },
  ];

  for (const { path, name } of LOGGED_IN_ROUTES) {
    test(`${name} (${path}) loads without offline UI or hydration errors`, async ({
      page,
      login,
    }) => {
      await loginReloadAndCheck(page, login, path);
    });
  }

  // ── Error boundary SSR test ──────────────────────────────────────────────

  test("OfflineAwareErrorBoundary shows real 404, not offline fallback, during SSR", async ({
    page,
    login,
  }) => {
    const errors = collectErrors(page);
    await login();

    await page.goto("/nonexistent-ssr-test-404", { timeout: 30000, waitUntil: "load" });

    // Must NOT show "You're offline" (the offline error fallback)
    await expect(page.getByText("You're offline")).not.toBeAttached({ timeout: 5000 });

    // Must show a 404 indicator — the actual error boundary, not offline fallback
    await expect(page.getByText(/can't find this page|not found|404/i).first()).toBeAttached({
      timeout: 5000,
    });

    const hydrationErrors = errors.filter(
      (e) => e.includes("No result found") || e.includes("SingleFetch"),
    );
    expect(hydrationErrors).toEqual([]);
  });
});
