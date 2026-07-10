import { test, expect } from '#tests/playwright-utils.ts'

async function dispatchOffline(page: import('@playwright/test').Page) {
	await page.evaluate(() => {
		try {
			Object.defineProperty(navigator, 'onLine', {
				configurable: true,
				get: () => false,
			})
		} catch {
			// navigator.onLine may already be false via Playwright offline mode
		}
		window.dispatchEvent(new Event('offline'))
	})
}

async function emulateOfflineUi(page: import('@playwright/test').Page) {
	await page.context().setOffline(true)
	await dispatchOffline(page)
}

async function emulateOfflineLoaderRequests(page: import('@playwright/test').Page) {
	// setOffline blocks localhost and prevents client navigations from completing.
	// Abort React Router data requests instead so clientLoaders fall back offline.
	await page.route(/\.data(?:\?.*)?$/, (route) => route.abort('internetdisconnected'))
	await dispatchOffline(page)
}

test.describe('Offline mode', () => {
	test('shows offline home when navigating home without network', async ({
		page,
		login,
	}) => {
		await login()
		await page.goto('/downloads')
		await page.waitForLoadState('networkidle')

		await emulateOfflineLoaderRequests(page)

		await Promise.all([
			page.waitForURL('/'),
			page.getByRole('link', { name: /epic/i }).click(),
		])

		await expect(page.getByRole('heading', { name: 'Listening offline' })).toBeVisible({
			timeout: 10000,
		})
		await expect(page.getByRole('link', { name: 'Downloads' })).toBeVisible()
	})

	test('shows offline banner on supported pages', async ({ page, login }) => {
		await login()
		await page.goto('/downloads')
		await page.waitForLoadState('networkidle')

		await emulateOfflineUi(page)

		await expect(
			page.getByText("You're offline. Showing downloaded music only."),
		).toBeVisible({ timeout: 10000 })
	})
})
