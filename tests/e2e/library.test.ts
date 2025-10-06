import { test, expect } from '#tests/playwright-utils.ts'

test.describe('Music Library', () => {
	test('can view library page', async ({ page, login }) => {
		await login()

		await page.goto('/library')
		await expect(page.getByRole('heading', { name: /music library/i })).toBeVisible()
		// Check for Add Track button in the empty state (more specific)
		await expect(page.getByRole('button', { name: 'Add Track' }).first()).toBeVisible()
		// Should show empty state or tracks
		await expect(page.getByRole('heading', { name: 'No tracks yet' })).toBeVisible()
	})

	test('can add a new track via modal', async ({ page, login }) => {
		await login()

		await page.goto('/library')
		
		// Open the modal by clicking the Add Track button in the empty state
		await page.getByRole('button', { name: 'Add Track' }).first().click()
		
		// Wait for modal to open
		await expect(page.getByRole('dialog')).toBeVisible()
		await expect(page.getByRole('heading', { name: 'Add New Track' })).toBeVisible()
		
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

		await page.goto('/library')
		
		// Open the modal by clicking the Add Track button in the empty state
		await page.getByRole('button', { name: 'Add Track' }).first().click()
		
		// Wait for modal to open
		await expect(page.getByRole('dialog')).toBeVisible()
		
		// Fill in track details but don't upload a file
		await page.getByRole('textbox', { name: /title/i }).fill('Test Track')
		await page.getByRole('textbox', { name: /artist/i }).fill('Test Artist')
		
		// Submit the form without file - this should trigger browser validation
		await page.getByRole('button', { name: /add track/i }).click()
		
		// Browser validation should prevent submission and modal should still be visible
		await expect(page.getByRole('dialog')).toBeVisible()
		await expect(page.getByRole('heading', { name: 'Add New Track' })).toBeVisible()
		
		// Check if the file input shows validation state
		const fileInput = page.getByLabel(/audio file/i)
		await expect(fileInput).toBeVisible()
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
