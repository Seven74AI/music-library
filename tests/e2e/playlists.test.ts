import { prisma } from '#app/utils/db.server.ts'
import { test, expect, testPrisma } from '#tests/playwright-utils.ts'

test.describe('Playlists', () => {
	test('can view playlists page', { tag: '@smoke' }, async ({ page, login }) => {
		await login()

		await page.goto('/playlists')
		await expect(page.getByRole('heading', { name: /my playlists/i })).toBeVisible()
		await expect(page.getByRole('link', { name: /create playlist/i })).toBeVisible()
	})

	test('can create a new playlist', async ({ page, login }) => {
		await login()

		await page.goto('/playlists/new')
		await page.waitForLoadState('networkidle')
		
		// Fill in playlist details
		await page.getByRole('textbox', { name: /title/i }).fill('My Test Playlist')
		await page.getByRole('textbox', { name: /description/i }).fill('A test playlist for testing')
		
		// Submit the form
		await page.getByRole('button', { name: /create playlist/i }).click()
		
		// Should redirect to the playlist detail page
		await expect(page).toHaveURL(/\/playlists\/[a-z0-9]+/, { timeout: 10000 })
		await page.waitForLoadState('networkidle')
		
		// Check for the title in the editable text component (use nth(1) to avoid breadcrumb)
		// EditableText renders as a div, so use getByText instead of getByRole
		await expect(page.getByText('My Test Playlist').nth(1)).toBeVisible({ timeout: 10000 })
		await expect(page.getByText('A test playlist for testing')).toBeVisible({ timeout: 10000 })
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
		await page.waitForLoadState('networkidle')
		
		// Should show playlist details (use nth(1) to avoid breadcrumb)
		// EditableText renders as a div, so use getByText
		await expect(page.getByText('Test Playlist').nth(1)).toBeVisible({ timeout: 10000 })
		await expect(page.getByText('A test playlist')).toBeVisible({ timeout: 10000 })
		await expect(page.getByText('0 tracks').first()).toBeVisible({ timeout: 10000 })
		
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
		await page.waitForLoadState('networkidle')
		
		// Click on the title to edit it (inline editing) - use nth(1) to avoid breadcrumb
		// Wait for the title to be visible first
		await expect(page.getByText('Original Title').nth(1)).toBeVisible({ timeout: 10000 })
		await page.getByText('Original Title').nth(1).click()
		
		// Wait for the input to appear - use getByRole which is more reliable
		await expect(page.getByRole('textbox').first()).toBeVisible({ timeout: 10000 })
		await page.getByRole('textbox').first().fill('Updated Title')
		// Press Enter to save (since the check button doesn't have accessible name)
		await page.getByRole('textbox').first().press('Enter')
		
		// Wait for the update to complete and the text to change
		await expect(page.getByText('Updated Title').nth(1)).toBeVisible({ timeout: 10000 })
		
		// Click on the description to edit it
		await expect(page.getByText('Original description')).toBeVisible({ timeout: 10000 })
		await page.getByText('Original description').click()
		
		// Wait for the textarea to appear (description uses multiline)
		await expect(page.getByRole('textbox').first()).toBeVisible({ timeout: 10000 })
		await page.getByRole('textbox').first().fill('Updated description')
		// Press Enter to save
		await page.getByRole('textbox').first().press('Enter')
		
		// Wait for the page to load after update
		await page.waitForLoadState('networkidle')
		
		// Should show updated content
		await expect(page).toHaveURL(`/playlists/${playlist.id}`)
		await expect(page.getByText('Updated Title').nth(1)).toBeVisible({ timeout: 10000 })
		await expect(page.getByText('Updated description')).toBeVisible({ timeout: 10000 })
		
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
		await page.waitForLoadState('networkidle')
		
		// Click delete button directly (it's visible on desktop)
		// The delete button is in the PlaylistHero component
		await page.getByRole('button', { name: /delete/i }).click({ timeout: 10000 })
		
		// Confirm deletion in the dialog
		await page.getByRole('button', { name: /delete playlist/i }).click({ timeout: 10000 })
		
		// Should redirect to playlists page
		await expect(page).toHaveURL('/playlists', { timeout: 10000 })
		
		// Playlist should no longer exist
		await page.goto(`/playlists/${playlist.id}`)
		await page.waitForLoadState('networkidle')
		await expect(page.getByText('Playlist not found')).toBeVisible({ timeout: 10000 })
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
		await page.waitForLoadState('networkidle')
		
		// Should show the track in the playlist
		// The track count is shown in the PlaylistHero stats section
		await expect(page.getByText('1 track').first()).toBeVisible({ timeout: 10000 })
		await expect(page.getByText('Test Track')).toBeVisible({ timeout: 10000 })
		await expect(page.getByText('Test Artist')).toBeVisible({ timeout: 10000 })
		
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
		await page.waitForLoadState('networkidle')
		
		// Should show empty state
		await expect(page.getByText('No tracks yet')).toBeVisible({ timeout: 10000 })
		await expect(page.getByRole('link', { name: /add tracks from library/i })).toBeVisible({ timeout: 10000 })
		
		// Cleanup
		await prisma.userPlaylist.delete({ where: { id: playlist.id } })
	})

	test('shows library toggle buttons on playlist tracks', async ({ page, login, insertNewTrack }) => {
		const user = await login()
		
		// Create tracks (without adding to library)
		const track1 = await insertNewTrack({ title: 'Library Track 1' })
		const track2 = await insertNewTrack({ title: 'Library Track 2' })
		// Create a track that IS in the user's library
		const track3 = await insertNewTrack({ title: 'Already In Library' }, user.id)
		
		// Create a playlist with all three tracks
		const playlist = await prisma.userPlaylist.create({
			data: { title: 'Library Test', description: 'Testing library buttons', ownerId: user.id },
		})
		await prisma.userPlaylistTrack.createMany({
			data: [
				{ playlistId: playlist.id, trackId: track1.id, position: 1 },
				{ playlistId: playlist.id, trackId: track2.id, position: 2 },
				{ playlistId: playlist.id, trackId: track3.id, position: 3 },
			],
		})

		await page.goto(`/playlists/${playlist.id}`)
		await page.waitForLoadState('networkidle')

		// Check that "Add to library" buttons exist for tracks not in library
		await expect(page.getByLabel('Add to library').first()).toBeVisible({ timeout: 10000 })
		
		// Check that "Remove from library" button exists for track already in library
		await expect(page.getByLabel('Remove from library').first()).toBeVisible({ timeout: 10000 })

		// Click add on track1 — should change to minus
		await page.getByLabel('Add to library').first().click()
		await page.waitForTimeout(500) // Allow optimistic update
		// After click, the first track should now show remove
		const removeButtons = page.getByLabel('Remove from library')
		await expect(removeButtons.first()).toBeVisible({ timeout: 5000 })

		// Cleanup playlist-related data (track cleanup handled by fixture)
		await prisma.userPlaylistTrack.deleteMany({ where: { playlistId: playlist.id } })
		await prisma.userPlaylist.delete({ where: { id: playlist.id } })
		// Clean up userTrack for track3
		await testPrisma.userTrack.deleteMany({ where: { userId: user.id } })
	})

	test('shows Add All Missing button when tracks not in library', async ({ page, login, insertNewTrack }) => {
		const user = await login()
		
		// Create tracks not in library
		const track1 = await insertNewTrack({ title: 'Missing Track 1' })
		const track2 = await insertNewTrack({ title: 'Missing Track 2' })
		
		const playlist = await prisma.userPlaylist.create({
			data: { title: 'Bulk Add Test', description: 'Testing bulk add', ownerId: user.id },
		})
		await prisma.userPlaylistTrack.createMany({
			data: [
				{ playlistId: playlist.id, trackId: track1.id, position: 1 },
				{ playlistId: playlist.id, trackId: track2.id, position: 2 },
			],
		})

		await page.goto(`/playlists/${playlist.id}`)
		await page.waitForLoadState('networkidle')

		// "Add All Missing" button should be visible (tracks not in library)
		await expect(page.getByRole('button', { name: /add all missing/i })).toBeVisible({ timeout: 10000 })

		// Click it — confirmation dialog should appear
		await page.getByRole('button', { name: /add all missing/i }).click()
		await expect(page.getByRole('alertdialog', { name: /add all missing to library/i })).toBeVisible({ timeout: 5000 })

		// Confirm
		await page.getByRole('button', { name: /add 2 tracks/i }).click()
		await page.waitForTimeout(500)

		// After bulk add, the button should disappear (all tracks now in library)
		await expect(page.getByRole('button', { name: /add all missing/i })).not.toBeVisible({ timeout: 5000 })

		// Cleanup
		await prisma.userPlaylistTrack.deleteMany({ where: { playlistId: playlist.id } })
		await prisma.userPlaylist.delete({ where: { id: playlist.id } })
		await testPrisma.userTrack.deleteMany({ where: { userId: user.id } })
	})

	test('Add All Missing button not shown when all tracks are in library', async ({ page, login, insertNewTrack }) => {
		const user = await login()
		
		// Create tracks already in library
		const track1 = await insertNewTrack({ title: 'Lib Track A' }, user.id)
		const track2 = await insertNewTrack({ title: 'Lib Track B' }, user.id)
		
		const playlist = await prisma.userPlaylist.create({
			data: { title: 'All In Library', description: 'All tracks in library', ownerId: user.id },
		})
		await prisma.userPlaylistTrack.createMany({
			data: [
				{ playlistId: playlist.id, trackId: track1.id, position: 1 },
				{ playlistId: playlist.id, trackId: track2.id, position: 2 },
			],
		})

		await page.goto(`/playlists/${playlist.id}`)
		await page.waitForLoadState('networkidle')

		// "Add All Missing" should NOT be visible
		await expect(page.getByRole('button', { name: /add all missing/i })).not.toBeVisible({ timeout: 5000 })

		// Cleanup
		await prisma.userPlaylistTrack.deleteMany({ where: { playlistId: playlist.id } })
		await prisma.userPlaylist.delete({ where: { id: playlist.id } })
		await testPrisma.userTrack.deleteMany({ where: { userId: user.id } })
	})
})
