import { test, expect } from '#tests/playwright-utils.ts'

async function emulateOffline(page: import('@playwright/test').Page) {
	await page.context().setOffline(true)
	// Playwright blocks localhost when offline, so we cannot reload/goto.
	// Dispatch the browser offline event so client hooks pick up the change.
	await page.evaluate(() => window.dispatchEvent(new Event('offline')))
}

test.describe('Offline mode', () => {
	test('shows offline home when navigating home without network', async ({
		page,
		login,
	}) => {
		await login()
		await page.goto('/downloads')
		await page.waitForLoadState('networkidle')

		await emulateOffline(page)
		await page.getByRole('link', { name: /epic/i }).click()

		await expect(page.getByRole('heading', { name: 'Listening offline' })).toBeVisible({
			timeout: 10000,
		})
		await expect(page.getByRole('link', { name: 'Downloads' })).toBeVisible()
	})

	test('shows offline banner on supported pages', async ({ page, login }) => {
		await login()
		await page.goto('/downloads')
		await page.waitForLoadState('networkidle')

		await emulateOffline(page)

		await expect(
			page.getByText("You're offline. Showing downloaded music only."),
		).toBeVisible({ timeout: 10000 })
	})
})
