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

	test('can preview track before importing from YouTube', async ({ page, login }) => {
		await login()

		await page.goto('/music/services/youtube/import')
		
		// Should be on YouTube import page
		await expect(page.getByRole('heading', { name: /import from youtube/i })).toBeVisible()
		
		// Enter a YouTube URL
		const youtubeUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' // Rick Roll for testing
		await page.getByRole('textbox', { name: /youtube url/i }).fill(youtubeUrl)
		
		// Click preview button
		await page.getByRole('button', { name: /preview track/i }).click()
		
		// Should stay on the same page and show preview
		await expect(page).toHaveURL(/\/music\/services\/youtube\/import$/)
		
		// Should show track preview with details
		await expect(page.getByRole('heading', { name: /preview track/i })).toBeVisible()
		await expect(page.getByText('Never Gonna Give You Up')).toBeVisible()
		await expect(page.getByText('Rick Astley', { exact: true })).toBeVisible()
		
		// Should have Add to Library button
		await expect(page.getByRole('button', { name: /add to library/i })).toBeVisible()
		
		// Should have Cancel button
		await expect(page.getByRole('button', { name: /cancel/i })).toBeVisible()
	})

	test('can cancel track preview and return to import form', async ({ page, login }) => {
		await login()

		await page.goto('/music/services/youtube/import')
		
		// Enter a YouTube URL
		const youtubeUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
		await page.getByRole('textbox', { name: /youtube url/i }).fill(youtubeUrl)
		
		// Click preview button
		await page.getByRole('button', { name: /preview track/i }).click()
		
		// Should show preview
		await expect(page.getByRole('heading', { name: /preview track/i })).toBeVisible()
		
		// Click cancel button
		await page.getByRole('button', { name: /cancel/i }).click()
		
		// Should return to import form (same page, but form should be visible again)
		await expect(page).toHaveURL(/\/music\/services\/youtube\/import$/)
		await expect(page.getByRole('textbox', { name: /youtube url/i })).toBeVisible()
	})

	test('can import track after preview', async ({ page, login }) => {
		await login()

		await page.goto('/music/services/youtube/import')
		
		// Enter a YouTube URL
		const youtubeUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
		await page.getByRole('textbox', { name: /youtube url/i }).fill(youtubeUrl)
		
		// Click preview button
		await page.getByRole('button', { name: /preview track/i }).click()
		
		// Should show preview
		await expect(page.getByRole('heading', { name: /preview track/i })).toBeVisible()
		await expect(page.getByText('Never Gonna Give You Up')).toBeVisible()
		
		// Click add to library button
		await page.getByRole('button', { name: /add to library/i }).click()
		
		// Should redirect to library with success message
		await expect(page).toHaveURL('/library')
		await expect(page.getByText('Track Imported!', { exact: true })).toBeVisible()
		await expect(page.getByRole('link', { name: /never gonna give you up/i })).toBeVisible()
	})

	test('shows error when YouTube URL is invalid', async ({ page, login }) => {
		await login()

		await page.goto('/music/services/youtube/import')
		
		// Enter an invalid URL
		await page.getByRole('textbox', { name: /youtube url/i }).fill('https://invalid-url.com')
		
		// Click preview button
		await page.getByRole('button', { name: /preview track/i }).click()
		
		// Should show error message
		await expect(page.getByText(/preview failed/i)).toBeVisible()
		await expect(page.getByText(/invalid.*url format/i)).toBeVisible()
	})

	test('shows preview with view button for already existing track', async ({ page, login }) => {
		await login()
		
		// First, import a track
		await page.goto('/music/services/youtube/import')
		
		const youtubeUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
		await page.getByRole('textbox', { name: /youtube url/i }).fill(youtubeUrl)
		await page.getByRole('button', { name: /preview track/i }).click()
		await page.getByRole('button', { name: /add to library/i }).click()
		
		// Wait for first import to complete
		await expect(page).toHaveURL('/library')
		
		// Now try to preview the same track again
		await page.goto('/music/services/youtube/import')
		await page.getByRole('textbox', { name: /youtube url/i }).fill(youtubeUrl)
		await page.getByRole('button', { name: /preview track/i }).click()
		
		// Should show preview with "already exists" message
		await expect(page).toHaveURL(/\/music\/services\/youtube\/import$/)
		await expect(page.getByText('Track Already in Library')).toBeVisible()
		await expect(page.getByText('This track is already in your library')).toBeVisible()
		
		// Should show "View Track" link instead of "Add to Library" button
		await expect(page.getByRole('link', { name: /view track/i })).toBeVisible()
		await expect(page.getByRole('button', { name: /add to library/i })).not.toBeVisible()
		
		// Should still show track details
		await expect(page.getByText('Never Gonna Give You Up')).toBeVisible()
		await expect(page.getByText('Rick Astley', { exact: true })).toBeVisible()
	})
})
