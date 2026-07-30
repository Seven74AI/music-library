import { test, expect } from "#tests/playwright-utils.ts";

test.describe("SSR hydration after login reload", () => {
  test("no SingleFetchNoResultError after login + reload", async ({ page, login }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));

    // Login
    await login();

    // Navigate to home with longer timeout
    await page.goto("/", { timeout: 30000, waitUntil: "load" }).catch(() => {
      consoleErrors.push("page.goto timed out");
      // Even if it times out, continue
    });
    await page.waitForTimeout(2000);

    // Reload the page (this triggers SSR hydration)
    await page.reload({ timeout: 30000, waitUntil: "load" }).catch(() => {
      consoleErrors.push("page.reload timed out");
    });
    await page.waitForTimeout(2000);

    const allErrors = [...consoleErrors, ...pageErrors];
    console.log("All errors:", JSON.stringify(allErrors));

    // Check for SingleFetchNoResultError
    const hydrationErrors = allErrors.filter(
      (e) => e.includes("No result found") || e.includes("routeId") || e.includes("SingleFetch"),
    );
    expect(hydrationErrors).toEqual([]);

    // Should NOT see offline banner
    await expect(page.getByText("You're offline")).not.toBeAttached({ timeout: 5000 });
  });
});
