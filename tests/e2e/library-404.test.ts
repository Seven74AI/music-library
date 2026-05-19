import { expect, test } from '#tests/playwright-utils.ts'

test('shows 404 for non-existent track', async ({ page, login, navigate }) => {
	await login()
	// First navigate to library to verify auth works
	await page.goto('/library')
	await page.waitForLoadState('networkidle')
	
	// Then navigate to a non-existent track
	const res = await page.goto('/library/non-existent-track-id-12345')
	expect(res?.status()).toBe(404)
	await expect(page.getByText(/We can't find this page/i)).toBeVisible()
})
