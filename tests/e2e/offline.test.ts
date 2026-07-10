import { test, expect } from '#tests/playwright-utils.ts'

test.describe('Offline mode', () => {
	test('shows offline home when opening / without network', async ({ page, login }) => {
		await login()
		await page.goto('/')
		await page.waitForLoadState('networkidle')

		await page.context().setOffline(true)
		await page.goto('/')
		await page.waitForLoadState('domcontentloaded')

		await expect(page.getByRole('heading', { name: 'Listening offline' })).toBeVisible({
			timeout: 10000,
		})
		await expect(page.getByRole('link', { name: 'Downloads' })).toBeVisible()
	})

	test('shows offline banner on supported pages', async ({ page, login }) => {
		await login()
		await page.goto('/downloads')
		await page.waitForLoadState('networkidle')

		await page.context().setOffline(true)
		await page.reload()
		await page.waitForLoadState('domcontentloaded')

		await expect(
			page.getByText("You're offline. Showing downloaded music only."),
		).toBeVisible({ timeout: 10000 })
	})
})
