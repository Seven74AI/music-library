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
		await expect(page.getByRole('heading', { name: 'My Test Playlist' })).toBeVisible()
		await expect(page.getByRole('paragraph').filter({ hasText: 'A test playlist for testing' })).toBeVisible()
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
		
		// Should show playlist details
		await expect(page.getByRole('heading', { name: 'Test Playlist' })).toBeVisible()
		await expect(page.getByRole('paragraph').filter({ hasText: 'A test playlist' })).toBeVisible()
		await expect(page.getByText('0 tracks')).toBeVisible()
		
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
		
		// Update the playlist
		await page.getByRole('textbox', { name: /title/i }).fill('Updated Title')
		await page.getByRole('textbox', { name: /description/i }).fill('Updated description')
		
		// Submit the update
		await page.getByRole('button', { name: /update playlist/i }).click()
		
		// Wait for the page to load after update
		await page.waitForLoadState('networkidle')
		
		// Should redirect back to the playlist page with updated content
		await expect(page).toHaveURL(`/playlists/${playlist.id}`)
		await expect(page.getByRole('heading', { name: 'Updated Title' })).toBeVisible()
		// Look for the description paragraph with the updated text
		await expect(page.getByRole('paragraph').filter({ hasText: 'Updated description' }).first()).toBeVisible()
		
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
		
		// Handle the confirmation dialog BEFORE clicking
		page.on('dialog', dialog => dialog.accept())
		
		// Click delete button and confirm
		await page.getByRole('button', { name: /delete playlist/i }).click()
		
		// Should redirect to playlists page
		await expect(page).toHaveURL('/playlists', { timeout: 10000 })
		
		// Playlist should no longer exist
		await page.goto(`/playlists/${playlist.id}`)
		await expect(page.getByText('Playlist not found')).toBeVisible()
	})

	test('shows tracks in playlist when tracks are added', async ({ page, login }) => {
		const user = await login()
		
		// Create a test track
		const track = await prisma.track.create({
			data: {
				title: 'Test Track',
				artist: 'Test Artist',
			},
		})
		
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
		await expect(page.getByText('1 track')).toBeVisible()
		await expect(page.getByText('Test Track')).toBeVisible()
		await expect(page.getByText('Test Artist')).toBeVisible()
		
		// Cleanup
		await prisma.userPlaylistTrack.delete({ where: { id: playlistTrack.id } })
		await prisma.userPlaylist.delete({ where: { id: playlist.id } })
		await prisma.track.delete({ where: { id: track.id } })
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
		await expect(page.getByText('No tracks in this playlist yet.')).toBeVisible()
		await expect(page.getByRole('link', { name: /add tracks from your library/i })).toBeVisible()
		
		// Cleanup
		await prisma.userPlaylist.delete({ where: { id: playlist.id } })
	})
})
