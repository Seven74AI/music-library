import { test, expect } from '#tests/playwright-utils.ts'

test.describe('Music Library', () => {
	test('can view library page', async ({ page, login }) => {
		await login()

		await page.goto('/library')
		await expect(page.getByRole('heading', { name: /music library/i })).toBeVisible()
		// Should show empty state or tracks
		await expect(page.getByRole('heading', { name: 'No tracks yet' })).toBeVisible()
	})


	test('shows tracks in library', async ({ page, login, insertNewTrack }) => {
		const user = await login()
		
		// Create a test track using the fixture (will be cleaned up automatically)
		await insertNewTrack({}, user.id)

		await page.goto('/library')
		
		// Should show the track in the table
		await expect(page.getByText('Test Track').first()).toBeVisible()
		await expect(page.getByText('Test Artist').first()).toBeVisible()
	})

	test('can view individual track', async ({ page, login, insertNewTrack }) => {
		const user = await login()
		
		// Create a test track using the fixture (will be cleaned up automatically)
		const track = await insertNewTrack({}, user.id)

		await page.goto(`/library/${track.id}`)
		
		// Should show track details
		await expect(page.getByRole('heading', { name: 'Test Track' })).toBeVisible()
		await expect(page.getByText('Test Artist')).toBeVisible()
	})

})
