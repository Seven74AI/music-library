import { prisma } from '#app/utils/db.server'
import { test, expect } from '#tests/playwright-utils'

// Test constants
const ONE_HOUR_MS = 60 * 60 * 1000
const TEST_YOUTUBE_USER_ID = 'test-youtube-user-id'
const TEST_ACCESS_TOKEN = 'test-access-token'
const TEST_REFRESH_TOKEN = 'test-refresh-token'
const TEST_VIDEO_ID = 'dQw4w9WgXcQ'
const TEST_PLAYLIST_ID = 'PLtest123'

// Type definitions for test data
interface TestYouTubeConnection {
  providerName: 'youtube'
  providerId: string
  userId: string
  tokens: string
}

interface TestYouTubePlaylist {
  youtubeId: string
  title: string
  description: string
  channelId: string
  channelTitle: string
  publishedAt: Date
  itemCount: number
  ownerId: string
  isActive: boolean
  thumbnailUrl?: string
  lastSyncedAt?: Date
}

/**
 * Creates test YouTube connection data for database seeding
 * @param userId - The user ID to associate with the connection
 * @returns Test connection data object
 */
const createTestYouTubeConnection = (userId: string): TestYouTubeConnection => ({
  providerName: 'youtube',
  providerId: TEST_YOUTUBE_USER_ID,
  userId,
  tokens: JSON.stringify({
    youtubeUserId: 'test-user-id',
    accessToken: TEST_ACCESS_TOKEN,
    refreshToken: TEST_REFRESH_TOKEN,
    expiryDate: Date.now() + ONE_HOUR_MS,
  }),
})

/**
 * Creates test YouTube playlist data with optional overrides
 * @param userId - The user ID to associate with the playlist
 * @param overrides - Optional overrides for default playlist data
 * @returns Test playlist data object
 */
const createTestPlaylist = (userId: string, overrides: Partial<TestYouTubePlaylist> = {}): TestYouTubePlaylist => ({
  youtubeId: TEST_PLAYLIST_ID,
  title: 'Test Playlist',
  description: 'A test playlist',
  channelId: 'UCtest123',
  channelTitle: 'Test Channel',
  publishedAt: new Date(),
  itemCount: 10,
  ownerId: userId,
  isActive: true,
  ...overrides,
})

test.describe('YouTube Playlists', () => {
  test('should display YouTube playlists page', async ({ page, login }) => {
    const user = await login()
    
    // Create YouTube connection first
    await prisma.connection.create({
      data: createTestYouTubeConnection(user.id),
    })
    
    await prisma.youTubePlaylist.create({
      data: createTestPlaylist(user.id),
    })

    await page.goto('/music/services/youtube/playlists')
    await expect(page).toHaveURL('/music/services/youtube/playlists')
    await expect(page.getByRole('heading', { name: /youtube playlists/i })).toBeVisible()
  })

  test('should show empty state when no playlists', async ({ page, login }) => {
    const ignoredUser = await login()

    await page.goto('/music/services/youtube/playlists')
    await expect(page).toHaveURL('/music/services/youtube/playlists')

    // Should show empty state
    await expect(page.getByText(/not connected to youtube/i)).toBeVisible()
    await expect(page.getByRole('link', { name: /connect youtube account/i })).toBeVisible()
  })

  test('should display playlist cards with correct information', async ({ page, login }) => {
    const user = await login()
    
    // Create YouTube connection first
    await prisma.connection.create({
      data: createTestYouTubeConnection(user.id),
    })
    
    await prisma.youTubePlaylist.create({
      data: createTestPlaylist(user.id, {
        youtubeId: 'PLtest456',
        title: 'My Awesome Playlist',
        description: 'This is a test playlist description',
        thumbnailUrl: 'https://example.com/thumbnail.jpg',
        itemCount: 25,
        lastSyncedAt: new Date(),
      }),
    })

    await page.goto('/music/services/youtube/playlists')
    await expect(page).toHaveURL('/music/services/youtube/playlists')

    // Should display playlist information
    await expect(page.getByText('My Awesome Playlist')).toBeVisible()
    await expect(page.getByText('This is a test playlist description')).toBeVisible()
    await expect(page.getByText('Test Channel')).toBeVisible()
    await expect(page.getByText('25 tracks')).toBeVisible()
    await expect(page.getByText('Active').first()).toBeVisible()
  })

  test('should allow removing playlists', async ({ page, login }) => {
    const user = await login()
    
    // Create YouTube connection first
    await prisma.connection.create({
      data: createTestYouTubeConnection(user.id),
    })
    
    const ignoredPlaylist = await prisma.youTubePlaylist.create({
      data: createTestPlaylist(user.id, {
        youtubeId: 'PLtest789',
      }),
    })

    await page.goto('/music/services/youtube/playlists')
    await expect(page).toHaveURL('/music/services/youtube/playlists')

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
