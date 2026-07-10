import { prisma } from '#app/utils/db.server.ts'
import { test, expect } from '#tests/playwright-utils.ts'

test.describe('Music Library', () => {
	test('can view library page', { tag: '@smoke' }, async ({ page, login }) => {
		await login()

		await page.goto('/library')
		// Wait for page to load
		await page.waitForLoadState('networkidle')
		// Check for the main heading
		await expect(page.getByRole('heading', { name: /music library/i })).toBeVisible({ timeout: 10000 })
		// Should show empty state or tracks
		await expect(page.getByRole('heading', { name: 'No tracks yet' })).toBeVisible({ timeout: 10000 })
	})


	test('shows tracks in library', { tag: '@smoke' }, async ({ page, login, insertNewTrack }) => {
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

	test('can create playlist from library track row', async ({ page, login, insertNewTrack }) => {
		const user = await login()
		const track = await insertNewTrack({}, user.id)

		await page.goto('/library')
		await page.waitForLoadState('networkidle')

		await page.getByRole('button', { name: 'More actions' }).first().click()
		await page.getByRole('menuitem', { name: 'Add to Playlist' }).click()
		await page.getByRole('link', { name: 'Create new playlist' }).click()

		await expect(page).toHaveURL(`/playlists/new?trackId=${track.id}`)
		await page.getByRole('textbox', { name: /title/i }).fill('From Library')
		await page.getByRole('button', { name: /create playlist/i }).click()

		await expect(page).toHaveURL('/library', { timeout: 10000 })

		const playlist = await prisma.userPlaylist.findFirst({
			where: { ownerId: user.id, title: 'From Library' },
			include: { tracks: true },
		})
		expect(playlist).not.toBeNull()
		expect(playlist?.tracks).toHaveLength(1)
		expect(playlist?.tracks[0]?.trackId).toBe(track.id)

		if (playlist) {
			await prisma.userPlaylistTrack.deleteMany({ where: { playlistId: playlist.id } })
			await prisma.userPlaylist.delete({ where: { id: playlist.id } })
		}
	})

})
