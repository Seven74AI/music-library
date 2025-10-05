import { prisma } from '#app/utils/db.server'
import { test, expect } from '#tests/playwright-utils'

test.describe('YouTube Playlists', () => {
  test('should display YouTube playlists page', async ({ page, login }) => {
    const user = await login()
    await prisma.youTubePlaylist.create({
      data: {
        youtubeId: 'PLtest123',
        title: 'Test Playlist',
        description: 'A test playlist',
        channelId: 'UCtest123',
        channelTitle: 'Test Channel',
        publishedAt: new Date(),
        itemCount: 10,
        ownerId: user.id,
        isActive: true,
      },
    })

    await page.goto('/youtube/playlists')
    await expect(page).toHaveURL('/youtube/playlists')
    await expect(page.getByRole('heading', { name: /youtube playlists/i })).toBeVisible()
  })

  test('should show empty state when no playlists', async ({ page, login }) => {
    const ignoredUser = await login()

    await page.goto('/youtube/playlists')
    await expect(page).toHaveURL('/youtube/playlists')

    // Should show empty state
    await expect(page.getByText(/no youtube playlists/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /connect youtube account/i })).toBeVisible()
  })

  test('should display playlist cards with correct information', async ({ page, login }) => {
    const user = await login()
    await prisma.youTubePlaylist.create({
      data: {
        youtubeId: 'PLtest123',
        title: 'My Awesome Playlist',
        description: 'This is a test playlist description',
        thumbnailUrl: 'https://example.com/thumbnail.jpg',
        channelId: 'UCtest123',
        channelTitle: 'Test Channel',
        publishedAt: new Date(),
        itemCount: 25,
        ownerId: user.id,
        isActive: true,
        lastSyncedAt: new Date(),
      },
    })

    await page.goto('/youtube/playlists')
    await expect(page).toHaveURL('/youtube/playlists')

    // Should display playlist information
    await expect(page.getByText('My Awesome Playlist')).toBeVisible()
    await expect(page.getByText('This is a test playlist description')).toBeVisible()
    await expect(page.getByText('Test Channel')).toBeVisible()
    await expect(page.getByText('25 videos')).toBeVisible()
    await expect(page.getByText('Active').first()).toBeVisible()
  })

  test('should allow removing playlists', async ({ page, login }) => {
    const user = await login()
    const ignoredPlaylist = await prisma.youTubePlaylist.create({
      data: {
        youtubeId: 'PLtest123',
        title: 'Test Playlist',
        description: 'A test playlist',
        channelId: 'UCtest123',
        channelTitle: 'Test Channel',
        publishedAt: new Date(),
        itemCount: 10,
        ownerId: user.id,
        isActive: true,
      },
    })

    await page.goto('/youtube/playlists')
    await expect(page).toHaveURL('/youtube/playlists')

    // Should display playlist
    await expect(page.getByRole('heading', { name: 'Test Playlist' })).toBeVisible()

    // Click remove button (button containing trash icon)
    // eslint-disable-next-line playwright/no-raw-locators
    await page.locator('form').filter({ has: page.locator('input[name="intent"][value="remove"]') }).getByRole('button').click()

    // Should show success message
    await expect(page.getByText(/playlist removed successfully/i)).toBeVisible()

    // Playlist should be removed from display
    await expect(page.getByRole('heading', { name: 'Test Playlist' })).not.toBeVisible()
  })
})
