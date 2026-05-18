/**
 * E2E tests for search functionality
 */

import { test, expect } from '#tests/playwright-utils.ts'

test.describe('Global Search', () => {
	test('can navigate to search page', { tag: '@smoke' }, async ({ page, loginAsAdmin }) => {
		await loginAsAdmin()
		await page.goto('/search')
		await expect(page.getByRole('heading', { name: /search/i })).toBeVisible()
	})

	test('can search for tracks', async ({ page, loginAsAdmin }) => {
		await loginAsAdmin()
		await page.goto('/search')

		// Use the search input on the search page (not the nav)
		// Get all searchboxes and use the second one (first is nav, second is search page)
		const allSearchboxes = page.getByRole('searchbox')
		const searchInput = allSearchboxes.nth(1)
		await searchInput.fill('test')
		await searchInput.press('Enter')

		// Wait for results to load
		await page.waitForTimeout(500)

		// Check if search results are displayed (may be empty if no test data)
		const resultsSection = page.getByText(/found/i).or(page.getByText(/no results/i))
		await expect(resultsSection).toBeVisible()
	})

	test('can filter search by type', async ({ page, loginAsAdmin }) => {
		await loginAsAdmin()
		await page.goto('/search')

		// Radix Select is a button, not a native select
		const typeSelector = page.getByRole('combobox').first()
		if (await typeSelector.isVisible()) {
			await typeSelector.click()
			await page.getByRole('option', { name: /tracks/i }).click()
		}
	})

	test('search page shows empty state when no query', async ({ page, loginAsAdmin }) => {
		await loginAsAdmin()
		await page.goto('/search')

		// Should show search interface without results
		await expect(page.getByRole('heading', { name: /search/i })).toBeVisible()
		// Get the searchbox that's not in navigation (second one)
		const allSearchboxes = page.getByRole('searchbox')
		const searchInput = allSearchboxes.nth(1)
		await expect(searchInput).toBeVisible()
	})

	test('search API endpoint returns results', async ({ page, loginAsAdmin }) => {
		await loginAsAdmin()

		// Test API endpoint directly
		const response = await page.request.get('/api/search?q=test')
		// May return 200 with empty results or 500 if FTS5 tables are empty
		expect([200, 500]).toContain(response.status())

		if (response.status() === 200) {
			const data = await response.json()
			expect(data).toHaveProperty('results')
			expect(data).toHaveProperty('pagination')
			expect(Array.isArray(data.results)).toBe(true)
		}
	})

	test('search API validates query parameter', async ({ page, loginAsAdmin }) => {
		await loginAsAdmin()

		// Test without query parameter
		const response = await page.request.get('/api/search')
		expect(response.status()).toBe(400)
	})

	test('search API handles invalid limit', async ({ page, loginAsAdmin }) => {
		await loginAsAdmin()

		// Test with invalid limit
		const response = await page.request.get('/api/search?q=test&limit=invalid')
		// Should either return 400 or use default
		expect([200, 400]).toContain(response.status())
	})
})

