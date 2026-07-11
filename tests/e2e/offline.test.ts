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
	await page.waitForFunction(() => navigator.onLine === false)
}

async function emulateOfflineLoaderRequests(page: import('@playwright/test').Page) {
	// Abort React Router data requests so root clientMiddleware can substitute offline fallbacks.
	await page.route(/\.data(?:\?.*)?$/, (route) => route.abort('internetdisconnected'))
	await dispatchOffline(page)
}

test.describe('Offline mode', () => {
	test('shows offline status when opening home without network', async ({
		page,
		login,
	}) => {
		await login()
		await page.goto('/library')
		await page.waitForLoadState('networkidle')

		await emulateOfflineLoaderRequests(page)

		await page.goto('/')
		await page.waitForLoadState('domcontentloaded')

		await expect(page.getByRole('status')).toContainText(
			"You're offline. Showing downloaded music only.",
			{ timeout: 10000 },
		)
	})

	test('shows offline banner on supported pages', async ({ page, login }) => {
		await login()
		await page.goto('/library')
		await page.waitForLoadState('networkidle')

		await emulateOfflineLoaderRequests(page)

		await page.goto('/search')
		await page.waitForLoadState('domcontentloaded')

		await expect(page.getByRole('status')).toContainText(
			"You're offline. Showing downloaded music only.",
			{ timeout: 10000 },
		)
	})

	test('shows offline blocker on search instead of browser network error', async ({
		page,
		login,
	}) => {
		await login()
		await page.goto('/library')
		await page.waitForLoadState('networkidle')

		await emulateOfflineLoaderRequests(page)

		await page.goto('/search')
		await page.waitForLoadState('domcontentloaded')

		await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible({
			timeout: 10000,
		})
	})
})
