/**
 * E2E tests for YouTube import page
 */

import { test, expect } from '#tests/playwright-utils.ts'

test.describe('YouTube Import Page', () => {
	test('can navigate to the import page', { tag: '@smoke' }, async ({
		page,
		loginAsAdmin,
	}) => {
		await loginAsAdmin()
		await page.goto('/music/services/youtube/import')

		await expect(
			page.getByRole('heading', { name: /import from youtube/i }),
		).toBeVisible()
	})

	test('shows search form with input and button', async ({
		page,
		loginAsAdmin,
	}) => {
		await loginAsAdmin()
		await page.goto('/music/services/youtube/import')

		// Search input should be visible
		const searchInput = page.getByPlaceholder(
			/enter youtube url or search by artist/i,
		)
		await expect(searchInput).toBeVisible()

		// Search button should be visible (use .first() — global nav bar also has a search button)
		await expect(page.getByRole('button', { name: /search/i }).first()).toBeVisible()
	})

	test('can search and see results with mock data', async ({
		page,
		loginAsAdmin,
	}) => {
		await loginAsAdmin()
		await page.goto('/music/services/youtube/import')

		// Type a search query
		const searchInput = page.getByPlaceholder(
			/enter youtube url or search by artist/i,
		)
		await searchInput.fill('test song')
		await page.getByRole('button', { name: /search/i }).click()

		// Wait for results to load (mock data returns 5 results)
		await page.waitForTimeout(1000)

		// Should show search results heading
		await expect(page.getByText(/search results/i)).toBeVisible()

		// Should show mock video titles
		await expect(
			page.getByText(/mock video.*test song/i).first(),
		).toBeVisible()
	})

	test('import button is present on search results', async ({
		page,
		loginAsAdmin,
	}) => {
		await loginAsAdmin()
		await page.goto('/music/services/youtube/import')

		// Search
		const searchInput = page.getByPlaceholder(
			/enter youtube url or search by artist/i,
		)
		await searchInput.fill('test')
		await page.getByRole('button', { name: /search/i }).click()
		await page.waitForTimeout(1000)

		// Each result should have an Import button
		const importButtons = page.getByRole('button', { name: /import/i })
		const count = await importButtons.count()
		expect(count).toBeGreaterThan(0)

		// First button should be "Import" (not "Importing...")
		await expect(importButtons.first()).toBeVisible()
	})

	test('can navigate back to YouTube services', async ({
		page,
		loginAsAdmin,
	}) => {
		await loginAsAdmin()
		await page.goto('/music/services/youtube/import')

		// Click back button
		await page.getByRole('link', { name: /back/i }).click()

		// Should navigate to YouTube services page
		await page.waitForURL('**/music/services/youtube')
	})
})
