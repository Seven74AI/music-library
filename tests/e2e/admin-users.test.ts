/**
 * E2E: admin user monitoring — list, disable, blocked login.
 */
import { expect } from "@playwright/test";
import { test } from "#tests/playwright-utils.ts";

test.describe("Admin users monitoring", { tag: "@slow" }, () => {
  test("admin can list users, disable one, and that user cannot log in", async ({
    page,
    loginAsAdmin,
    insertNewUser,
  }) => {
    // The fixture tracks the user for cleanup, so a mid-test failure cannot leak it.
    const target = await insertNewUser({ password: "kodylovesyou" });

    await loginAsAdmin();
    await page.goto("/admin/users");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByRole("heading", { name: /^users$/i })).toBeVisible();
    await page.getByPlaceholder(/search username/i).fill(target.username);
    await page.getByRole("button", { name: /^search$/i }).click();
    await page.waitForLoadState("domcontentloaded");

    await page.getByRole("link", { name: target.username }).click();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByRole("heading", { name: target.username })).toBeVisible();

    await page.getByRole("button", { name: /disable account/i }).click();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText(/disabled/i).first()).toBeVisible();

    await page.getByRole("button", { name: /user menu/i }).click();
    await page.getByRole("menuitem", { name: /logout/i }).click();
    await page.waitForURL(/\/(login)?$/);

    await page.goto("/login");
    await page.getByLabel(/^username$/i).fill(target.username);
    await page.getByLabel(/^password$/i).fill("kodylovesyou");
    await page.getByRole("button", { name: /log in/i }).click();
    await expect(page.getByText(/this account has been disabled/i)).toBeVisible();
  });

  test("admin overview shows usage heading", async ({ page, loginAsAdmin }) => {
    await loginAsAdmin();
    await page.goto("/admin");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByRole("heading", { name: /admin overview/i })).toBeVisible();
    await expect(page.getByText(/dau today/i)).toBeVisible();
  });
});
