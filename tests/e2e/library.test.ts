import { test, expect } from '#tests/playwright-utils.ts'

test.describe('Music Library', () => {
	test('can view library page', async ({ page, login }) => {
		await login()

		await page.goto('/library')
		// Wait for page to load
		await page.waitForLoadState('networkidle')
		// Check for the main heading
		await expect(page.getByRole('heading', { name: /music library/i })).toBeVisible({ timeout: 10000 })
		// Should show empty state or tracks
		await expect(page.getByRole('heading', { name: 'No tracks yet' })).toBeVisible({ timeout: 10000 })
	})


	test('shows tracks in library', async ({ page, login, insertNewTrack }) => {
		const user = await login()
		
		// Create a test track using the fixture (will be cleaned up automatically)
		await insertNewTrack({}, user.id)

		await page.goto('/library')
		// Wait for page to load
		await page.waitForLoadState('networkidle')
		
		// Should show the track in the table
		await expect(page.getByText('Test Track').first()).toBeVisible({ timeout: 10000 })
		await expect(page.getByText('Test Artist').first()).toBeVisible({ timeout: 10000 })
	})

	test('can view individual track', async ({ page, login, insertNewTrack }) => {
		const user = await login()
		
		// Create a test track using the fixture (will be cleaned up automatically)
		const track = await insertNewTrack({}, user.id)

		await page.goto(`/library/${track.id}`)
		// Wait for page to load
		await page.waitForLoadState('networkidle')
		
		// Should show track details - h2 with track title
		await expect(page.getByRole('heading', { name: 'Test Track', level: 2 })).toBeVisible({ timeout: 10000 })
		await expect(page.getByText('Test Artist')).toBeVisible({ timeout: 10000 })
	})

})
