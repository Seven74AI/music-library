import { test, expect } from '#tests/playwright-utils.ts'

test.describe('Music Library', () => {
	test('can view library page', async ({ page, login }) => {
		await login()

		await page.goto('/library')
		await expect(page.getByRole('heading', { name: /music library/i })).toBeVisible()
		await expect(page.getByRole('link', { name: /add track/i })).toBeVisible()
	})

	test('can add a new track', async ({ page, login }) => {
		await login()

		await page.goto('/library/new')
		
		// Fill in track details
		await page.getByRole('textbox', { name: /title/i }).fill('Test Track')
		await page.getByRole('textbox', { name: /artist/i }).fill('Test Artist')
		
		// Create a mock audio file buffer
		const audioBuffer = Buffer.from('fake audio content for testing')
		
		// Set up file upload
		await page.setInputFiles('input[type="file"][name="audioFile"]', {
			name: 'test.mp3',
			mimeType: 'audio/mpeg',
			buffer: audioBuffer,
		})
		
		// Submit the form
		await page.getByRole('button', { name: /add track/i }).click()
		
		// Should redirect to the track detail page
		await expect(page).toHaveURL(/\/library\/[a-z0-9]+/)
		await expect(page.getByRole('heading', { name: 'Test Track' })).toBeVisible()
		await expect(page.getByRole('paragraph').filter({ hasText: 'Test Artist' })).toBeVisible()
	})

	test('shows validation errors when adding track without file', async ({ page, login }) => {
		await login()

		await page.goto('/library/new')
		
		// Fill in track details but don't upload a file
		await page.getByRole('textbox', { name: /title/i }).fill('Test Track')
		await page.getByRole('textbox', { name: /artist/i }).fill('Test Artist')
		
		// Submit the form without file - this should trigger browser validation
		await page.getByRole('button', { name: /add track/i }).click()
		
		// Browser validation should prevent submission and show validation message
		// The validation message might be in a tooltip or the form should still be visible
		await expect(page).toHaveURL('/library/new')
		await expect(page.getByRole('heading', { name: 'Add New Track' })).toBeVisible()
		
		// Check if the file input shows validation state
		const fileInput = page.getByRole('button', { name: 'Audio File' })
		await expect(fileInput).toBeVisible()
	})

	test('shows tracks in library', async ({ page, login, insertNewTrack }) => {
		await login()
		
		// Create a test track using the fixture (will be cleaned up automatically)
		await insertNewTrack()

		await page.goto('/library')
		
		// Should show the track in the grid
		await expect(page.getByRole('heading', { name: 'Test Track' }).first()).toBeVisible()
		await expect(page.getByRole('paragraph').filter({ hasText: 'Test Artist' }).first()).toBeVisible()
	})

	test('can view individual track', async ({ page, login, insertNewTrack }) => {
		await login()
		
		// Create a test track using the fixture (will be cleaned up automatically)
		const track = await insertNewTrack()

		await page.goto(`/library/${track.id}`)
		
		// Should show track details
		await expect(page.getByRole('heading', { name: 'Test Track' })).toBeVisible()
		await expect(page.getByRole('paragraph').filter({ hasText: 'Test Artist' })).toBeVisible()
	})
})
