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
	// Abort React Router data requests so client middleware can substitute offline fallbacks.
	await page.route(/\.data(?:\?.*)?$/, (route) => route.abort('internetdisconnected'))
	await dispatchOffline(page)
}

async function navigateOfflineClient(
	page: import('@playwright/test').Page,
	navigate: () => Promise<void>,
) {
	await navigate()
	await page.waitForLoadState('domcontentloaded')
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

		await navigateOfflineClient(page, async () => {
			await Promise.all([
				page.waitForURL('/'),
				page.getByRole('link', { name: /epic/i }).click(),
			])
		})

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

		await navigateOfflineClient(page, async () => {
			await Promise.all([
				page.waitForURL(/\/search(?:\?.*)?$/),
				page
					.locator('header form[action="/search"]')
					.getByRole('button', { name: 'Search' })
					.click(),
			])
		})

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

		await navigateOfflineClient(page, async () => {
			await Promise.all([
				page.waitForURL(/\/search(?:\?.*)?$/),
				page
					.locator('header form[action="/search"]')
					.getByRole('button', { name: 'Search' })
					.click(),
			])
		})

		await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible({
			timeout: 10000,
		})
	})

	test('shows offline blocker on settings instead of a blank page', async ({
		page,
		login,
	}) => {
		await login()
		await page.goto('/library')
		await page.waitForLoadState('networkidle')

		await emulateOfflineLoaderRequests(page)

		await navigateOfflineClient(page, async () => {
			await page.goto('/settings/profile')
		})

		await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible({
			timeout: 10000,
		})
	})

	test('shows offline blocker on music services instead of a blank page', async ({
		page,
		login,
	}) => {
		await login()
		await page.goto('/library')
		await page.waitForLoadState('networkidle')

		await emulateOfflineLoaderRequests(page)

		await navigateOfflineClient(page, async () => {
			await page.goto('/music/services')
		})

		await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible({
			timeout: 10000,
		})
	})
})
