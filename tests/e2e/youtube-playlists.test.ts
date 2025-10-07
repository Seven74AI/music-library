import { prisma } from '#app/utils/db.server'
import { test, expect } from '#tests/playwright-utils'

// Test constants
const ONE_HOUR_MS = 60 * 60 * 1000
const YOUTUBE_SERVICE_ID = 'clnf2zvli0000pcou3zzzzome' // Fixed Service ID from migration

// Test data constants
const TEST_YOUTUBE_USER_ID = 'test-youtube-user-id'
const TEST_ACCESS_TOKEN = 'test-access-token'
const TEST_REFRESH_TOKEN = 'test-refresh-token'

const TEST_PLAYLIST_IDS = {
  FIRST: 'PLtest123',
  SECOND: 'PLtest456',
  THIRD: 'PLtest999',
} as const

const TEST_CHANNEL_DATA = {
  ID: 'test-channel-id',
  TITLE: 'Test Channel',
} as const

// Type definitions for test data
interface TestYouTubeConnection {
  providerName: 'youtube'
  providerId: string
  userId: string
  tokens: string
}

/**
 * Creates test YouTube connection data for database seeding
 * 
 * @param userId - The user ID to associate with the connection
 * @returns Test connection data object with mock tokens
 */
const createTestYouTubeConnection = (userId: string): TestYouTubeConnection => ({
  providerName: 'youtube',
  providerId: TEST_YOUTUBE_USER_ID,
  userId,
  tokens: JSON.stringify({
    youtubeUserId: 'test-user-id',
    access_token: TEST_ACCESS_TOKEN,
    refresh_token: TEST_REFRESH_TOKEN,
    expiry_date: Date.now() + ONE_HOUR_MS,
  }),
})

/**
 * Creates test service playlist data for database seeding
 * 
 * @param userId - The user ID to associate with the playlist
 * @param externalId - The external playlist ID
 * @param title - The playlist title
 * @param description - The playlist description
 * @param itemCount - The number of items in the playlist
 * @returns Test service playlist data object
 */
const createTestServicePlaylist = (
  userId: string,
  externalId: string,
  title: string,
  description: string,
  itemCount: number = 5
) => ({
  serviceId: YOUTUBE_SERVICE_ID,
  externalId,
  title,
  description,
  channelId: TEST_CHANNEL_DATA.ID,
  channelTitle: TEST_CHANNEL_DATA.TITLE,
  publishedAt: new Date(),
  itemCount,
  ownerId: userId,
  isActive: true,
  lastSyncedAt: new Date(),
})

// Note: Server-side mocks are now handled in app/utils/youtube.server.ts
// when MOCKS=true environment variable is set

/**
 * YouTube Service Integration Tests
 * 
 * Tests the complete YouTube service integration flow including:
 * - Playlist discovery and display
 * - Playlist synchronization
 * - Playlist management (view, remove)
 * - Error handling and edge cases
 */
test.describe('YouTube Service Integration', () => {
  // Optimized configuration for the test group
  test.describe.configure({ timeout: 30 * 1000 }) // Longer timeout for the group
  
  /**
   * Clean up test data before each test to ensure isolation
   * ServicePlaylistTrack will be auto-deleted via CASCADE
   */
  test.beforeEach(async () => {
    try {
      await Promise.all([
        prisma.connection.deleteMany({
          where: { providerName: 'youtube' },
        }),
        prisma.servicePlaylist.deleteMany({
          where: {
            serviceId: YOUTUBE_SERVICE_ID
          }
        })
      ])
    } catch (error) {
      console.error('Error during test cleanup:', error)
      // Don't fail the test due to cleanup errors, but log them
    }
  })

  test('should display YouTube playlists discovery page without connection', async ({ page, login }) => {
    // Test that the discovery page shows connection prompt when user is not connected
    await login()

    await page.goto('/music/services/youtube/playlists')
    await expect(page).toHaveURL('/music/services/youtube/playlists')
    
    // Should display connection required message
    await expect(page.getByText(/connect your youtube account/i)).toBeVisible()
    await expect(page.getByRole('link', { name: /connect youtube/i })).toBeVisible()
  })

  test('should display YouTube playlists discovery page with mocked API', async ({ page, login }) => {
    // Test that the discovery page shows playlists when user is connected and API is mocked
    const user = await login()

    // Create YouTube connection
    await prisma.connection.create({
      data: createTestYouTubeConnection(user.id),
    })

    await page.goto('/music/services/youtube/playlists')
    await expect(page).toHaveURL('/music/services/youtube/playlists')
    
    // Should display mocked playlists from server-side mocks
    await expect(page.getByText('My Test Playlist')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Another Test Playlist' })).toBeVisible()
    
    // Should show sync status and actions
    await expect(page.getByText('Test Channel')).toBeVisible()
    await expect(page.getByText('Another Channel')).toBeVisible()
    await expect(page.getByText('5 tracks')).toBeVisible()
    await expect(page.getByText('10 tracks')).toBeVisible()
  })

  test('should add playlist to sync from discovery page', async ({ page, login }) => {
    // Test that users can add playlists to sync from the discovery page
    const user = await login()

    // Create YouTube connection
    await prisma.connection.create({
      data: createTestYouTubeConnection(user.id),
    })

    await page.goto('/music/services/youtube/playlists')
    
    // Should display mocked playlists
    await expect(page.getByText('My Test Playlist')).toBeVisible()
    
    // Click add to sync button for first playlist
    await page.getByRole('button', { name: /add my test playlist to sync/i }).click()
    
    // Should show success message
    await expect(page.getByText(/successfully synced/i)).toBeVisible()
  })

  test('should display synced playlists page', async ({ page, login }) => {
    // Test that the synced playlists page displays user's synced playlists correctly
    const user = await login()

    // Create a synced playlist using reusable test data
    const playlistData = createTestServicePlaylist(
      user.id,
      TEST_PLAYLIST_IDS.SECOND,
      'My Synced Playlist',
      'A synced playlist',
      10
    )

    await prisma.servicePlaylist.upsert({
      where: {
        serviceId_externalId: {
          serviceId: YOUTUBE_SERVICE_ID,
          externalId: TEST_PLAYLIST_IDS.SECOND
        }
      },
      update: {},
      create: playlistData,
    })

    await page.goto('/music/services/youtube/synced-playlists')
    await expect(page).toHaveURL('/music/services/youtube/synced-playlists')
    
    // Should display the synced playlist
    await expect(page.getByText('My Synced Playlist')).toBeVisible()
    await expect(page.getByText('Test Channel')).toBeVisible()
    await expect(page.getByText('10 tracks')).toBeVisible()
  })

  test('should navigate to playlist details', async ({ page, login }) => {
    // Test that users can navigate to individual playlist details from the synced playlists page
    const user = await login()

    // Create YouTube connection
    await prisma.connection.create({
      data: createTestYouTubeConnection(user.id),
    })

    // Create a synced playlist using reusable test data
    const playlistData = createTestServicePlaylist(
      user.id,
      TEST_PLAYLIST_IDS.SECOND,
      'Test Playlist',
      'A test playlist',
      5
    )

    const playlist = await prisma.servicePlaylist.create({
      data: playlistData,
    })

    await page.goto('/music/services/youtube/synced-playlists')
    
    // First check if the playlist is visible
    await expect(page.getByRole('heading', { name: 'Test Playlist' })).toBeVisible()
    
    // Click view details button using aria-label
    await page.getByRole('link', { name: /view details for test playlist/i }).click()
    
    // Should navigate to playlist details
    await expect(page).toHaveURL(`/music/services/youtube/playlist/${playlist.id}`)
    await expect(page.getByRole('heading', { name: 'Test Playlist', level: 1 })).toBeVisible()
  })

  test('should remove synced playlist', async ({ page, login }) => {
    // Test that users can remove playlists from sync with confirmation dialog
    const user = await login()

    // Create a synced playlist using reusable test data
    const playlistData = createTestServicePlaylist(
      user.id,
      TEST_PLAYLIST_IDS.THIRD,
      'Playlist to Remove',
      'This playlist will be removed',
      3
    )

    await prisma.servicePlaylist.upsert({
      where: {
        serviceId_externalId: {
          serviceId: YOUTUBE_SERVICE_ID,
          externalId: TEST_PLAYLIST_IDS.THIRD
        }
      },
      update: {},
      create: playlistData,
    })

    await page.goto('/music/services/youtube/synced-playlists')
    
    // Should display the playlist
    await expect(page.getByText('Playlist to Remove')).toBeVisible()
    
    // Handle confirmation dialog before clicking
    page.on('dialog', dialog => dialog.accept())
    
    // Click remove button using aria-label
    await page.getByRole('button', { name: /remove playlist to remove from sync/i }).click()
    
    // Should show success message
    await expect(page.getByText('Playlist removed from sync successfully')).toBeVisible()
  })
})
