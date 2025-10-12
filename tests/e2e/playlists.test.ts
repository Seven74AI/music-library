import { prisma } from '#app/utils/db.server.ts'
import { test, expect } from '#tests/playwright-utils.ts'

test.describe('Playlists', () => {
	test('can view playlists page', async ({ page, login }) => {
		await login()

		await page.goto('/playlists')
		await expect(page.getByRole('heading', { name: /my playlists/i })).toBeVisible()
		await expect(page.getByRole('link', { name: /create playlist/i })).toBeVisible()
	})

	test('can create a new playlist', async ({ page, login }) => {
		await login()

		await page.goto('/playlists/new')
		
		// Fill in playlist details
		await page.getByRole('textbox', { name: /title/i }).fill('My Test Playlist')
		await page.getByRole('textbox', { name: /description/i }).fill('A test playlist for testing')
		
		// Submit the form
		await page.getByRole('button', { name: /create playlist/i }).click()
		
		// Should redirect to the playlist detail page
		await expect(page).toHaveURL(/\/playlists\/[a-z0-9]+/)
		// Check for the title in the editable text component (use nth(1) to avoid breadcrumb)
		await expect(page.getByText('My Test Playlist').nth(1)).toBeVisible()
		await expect(page.getByText('A test playlist for testing')).toBeVisible()
	})

	test('shows validation errors when creating playlist without title', async ({ page, login }) => {
		await login()

		await page.goto('/playlists/new')
		
		// Fill in description but not title
		await page.getByRole('textbox', { name: /description/i }).fill('A test playlist for testing')
		
		// Submit the form
		await page.getByRole('button', { name: /create playlist/i }).click()
		
		// Should stay on the form page and show error
		await expect(page).toHaveURL('/playlists/new')
		await expect(page.getByRole('heading', { name: 'Create New Playlist' })).toBeVisible()
	})

	test('shows playlists in playlists page', async ({ page, login }) => {
		const user = await login()
		
		// Create a test playlist
		const playlist = await prisma.userPlaylist.create({
			data: {
				title: 'Test Playlist',
				description: 'A test playlist',
				ownerId: user.id,
			},
		})

		await page.goto('/playlists')
		
		// Should show the playlist in the grid
		await expect(page.getByRole('heading', { name: 'Test Playlist' }).first()).toBeVisible()
		await expect(page.getByText('A test playlist').first()).toBeVisible()
		await expect(page.getByText('0 tracks').first()).toBeVisible()
		
		// Cleanup
		await prisma.userPlaylist.delete({ where: { id: playlist.id } })
	})

	test('can view individual playlist', async ({ page, login }) => {
		const user = await login()
		
		// Create a test playlist
		const playlist = await prisma.userPlaylist.create({
			data: {
				title: 'Test Playlist',
				description: 'A test playlist',
				ownerId: user.id,
			},
		})

		await page.goto(`/playlists/${playlist.id}`)
		
		// Should show playlist details (use nth(1) to avoid breadcrumb)
		await expect(page.getByText('Test Playlist').nth(1)).toBeVisible()
		await expect(page.getByText('A test playlist')).toBeVisible()
		await expect(page.getByText('0 tracks').first()).toBeVisible()
		
		// Cleanup
		await prisma.userPlaylist.delete({ where: { id: playlist.id } })
	})

	test('can edit playlist', async ({ page, login }) => {
		const user = await login()
		
		// Create a test playlist
		const playlist = await prisma.userPlaylist.create({
			data: {
				title: 'Original Title',
				description: 'Original description',
				ownerId: user.id,
			},
		})

		await page.goto(`/playlists/${playlist.id}`)
		
		// Click on the title to edit it (inline editing) - use nth(1) to avoid breadcrumb
		await page.getByText('Original Title').nth(1).click()
		await page.getByRole('textbox').fill('Updated Title')
		// Press Enter to save (since the check button doesn't have accessible name)
		await page.getByRole('textbox').press('Enter')
		
		// Click on the description to edit it
		await page.getByText('Original description').click()
		await page.getByRole('textbox').fill('Updated description')
		// Press Enter to save
		await page.getByRole('textbox').press('Enter')
		
		// Wait for the page to load after update
		await page.waitForLoadState('networkidle')
		
		// Should show updated content
		await expect(page).toHaveURL(`/playlists/${playlist.id}`)
		await expect(page.getByText('Updated Title').nth(1)).toBeVisible()
		await expect(page.getByText('Updated description')).toBeVisible()
		
		// Cleanup
		await prisma.userPlaylist.delete({ where: { id: playlist.id } })
	})

	test('can delete playlist', async ({ page, login }) => {
		const user = await login()
		
		// Create a test playlist
		const playlist = await prisma.userPlaylist.create({
			data: {
				title: 'To Be Deleted',
				description: 'This playlist will be deleted',
				ownerId: user.id,
			},
		})

		await page.goto(`/playlists/${playlist.id}`)
		
		// Click delete button directly (it's visible on desktop)
		await page.getByRole('button', { name: /delete/i }).click()
		
		// Confirm deletion in the dialog
		await page.getByRole('button', { name: /delete playlist/i }).click()
		
		// Should redirect to playlists page
		await expect(page).toHaveURL('/playlists', { timeout: 10000 })
		
		// Playlist should no longer exist
		await page.goto(`/playlists/${playlist.id}`)
		await expect(page.getByText('Playlist not found')).toBeVisible()
	})

	test('shows tracks in playlist when tracks are added', async ({ page, login, insertNewTrack }) => {
		const user = await login()
		
		// Create a test track using the fixture (will be cleaned up automatically)
		const track = await insertNewTrack()
		
		// Create a test playlist
		const playlist = await prisma.userPlaylist.create({
			data: {
				title: 'Test Playlist',
				description: 'A test playlist',
				ownerId: user.id,
			},
		})

		// Add track to playlist
		const playlistTrack = await prisma.userPlaylistTrack.create({
			data: {
				playlistId: playlist.id,
				trackId: track.id,
				position: 1,
			},
		})

		await page.goto(`/playlists/${playlist.id}`)
		
		// Should show the track in the playlist
		await expect(page.getByText('1 track').first()).toBeVisible()
		await expect(page.getByText('Test Track')).toBeVisible()
		await expect(page.getByText('Test Artist')).toBeVisible()
		
		// Cleanup playlist-related data (track cleanup is handled by fixture)
		await prisma.userPlaylistTrack.delete({ where: { id: playlistTrack.id } })
		await prisma.userPlaylist.delete({ where: { id: playlist.id } })
	})

	test('shows empty state when playlist has no tracks', async ({ page, login }) => {
		const user = await login()
		
		// Create a test playlist
		const playlist = await prisma.userPlaylist.create({
			data: {
				title: 'Empty Playlist',
				description: 'A playlist with no tracks',
				ownerId: user.id,
			},
		})

		await page.goto(`/playlists/${playlist.id}`)
		
		// Should show empty state
		await expect(page.getByText('No tracks yet')).toBeVisible()
		await expect(page.getByRole('link', { name: /add tracks from library/i })).toBeVisible()
		
		// Cleanup
		await prisma.userPlaylist.delete({ where: { id: playlist.id } })
	})
})
