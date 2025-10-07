import { prisma } from '#app/utils/db.server'
import { test, expect } from '#tests/playwright-utils'

// Test constants
const ONE_HOUR_MS = 60 * 60 * 1000
const TEST_YOUTUBE_USER_ID = 'test-youtube-user-id'
const TEST_ACCESS_TOKEN = 'test-access-token'
const TEST_REFRESH_TOKEN = 'test-refresh-token'

// Test data constants (for future use)
// const TEST_PLAYLIST_IDS = {
//   FIRST: 'PLtest123',
//   SECOND: 'PLtest456',
//   THIRD: 'PLtest999',
// } as const

// Type definitions for test data
interface TestYouTubeConnection {
  providerName: 'youtube'
  providerId: string
  userId: string
  tokens: string
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

// Note: Server-side mocks are now handled in app/utils/youtube.server.ts
// when MOCKS=true environment variable is set

test.describe('YouTube Service Integration', () => {
  // Optimized configuration for the test group
  test.describe.configure({ timeout: 30 * 1000 }) // Longer timeout for the group
  test.beforeEach(async () => {
    // Optimized cleanup - batch deletion
    await Promise.all([
      prisma.connection.deleteMany({
        where: { providerName: 'youtube' },
      }),
      prisma.servicePlaylistTrack.deleteMany({
        where: {
          playlist: {
            service: { name: 'youtube' }
          }
        }
      }),
      prisma.servicePlaylist.deleteMany({
        where: {
          service: { name: 'youtube' }
        }
      })
    ])
  })

  test('should display YouTube playlists discovery page without connection', async ({ page, login }) => {
    await login()
    
    // Create YouTube service
    await prisma.service.upsert({
      where: { name: 'youtube' },
      update: {},
      create: {
        name: 'youtube',
        displayName: 'YouTube',
        baseUrl: 'https://youtube.com',
      },
    })

    await page.goto('/music/services/youtube/playlists')
    await expect(page).toHaveURL('/music/services/youtube/playlists')
    
    // Should display connection required message
    await expect(page.getByText(/connect your youtube account/i)).toBeVisible()
    await expect(page.getByRole('link', { name: /connect youtube/i })).toBeVisible()
  })

  test('should display YouTube playlists discovery page with mocked API', async ({ page, login }) => {
    const user = await login()
    
    // Create YouTube service
    await prisma.service.upsert({
      where: { name: 'youtube' },
      update: {},
      create: {
        name: 'youtube',
        displayName: 'YouTube',
        baseUrl: 'https://youtube.com',
      },
    })

    // Create YouTube connection
    await prisma.connection.create({
      data: createTestYouTubeConnection(user.id),
    })

    await page.goto('/music/services/youtube/playlists')
    await expect(page).toHaveURL('/music/services/youtube/playlists')
    
    // Should display mocked playlists from server-side mocks
    await expect(page.getByRole('heading', { name: 'My Test Playlist' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Another Test Playlist' })).toBeVisible()
    
    // Should show sync status and actions
    await expect(page.getByText('Test Channel')).toBeVisible()
    await expect(page.getByText('Another Channel')).toBeVisible()
    await expect(page.getByText('5 tracks')).toBeVisible()
    await expect(page.getByText('10 tracks')).toBeVisible()
  })

  test('should add playlist to sync from discovery page', async ({ page, login }) => {
    const user = await login()
    
    // Create YouTube service
    await prisma.service.upsert({
      where: { name: 'youtube' },
      update: {},
      create: {
        name: 'youtube',
        displayName: 'YouTube',
        baseUrl: 'https://youtube.com',
      },
    })

    // Create YouTube connection
    await prisma.connection.upsert({
      where: {
        providerName_providerId: {
          providerName: 'youtube',
          providerId: TEST_YOUTUBE_USER_ID,
        },
      },
      update: {},
      create: createTestYouTubeConnection(user.id),
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
    const user = await login()
    
    // Create YouTube service
    const service = await prisma.service.upsert({
      where: { name: 'youtube' },
      update: {},
      create: {
        name: 'youtube',
        displayName: 'YouTube',
        baseUrl: 'https://youtube.com',
      },
    })

    // Create a synced playlist
    await prisma.servicePlaylist.upsert({
      where: {
        serviceId_externalId: {
          serviceId: service.id,
          externalId: 'PLtest456'
        }
      },
      update: {},
      create: {
        serviceId: service.id,
        externalId: 'PLtest456',
        title: 'My Synced Playlist',
        description: 'A synced playlist',
        channelId: 'test-channel-id',
        channelTitle: 'Test Channel',
        publishedAt: new Date(),
        itemCount: 10,
        ownerId: user.id,
        isActive: true,
        lastSyncedAt: new Date(),
      },
    })

    await page.goto('/music/services/youtube/synced-playlists')
    await expect(page).toHaveURL('/music/services/youtube/synced-playlists')
    
    // Should display the synced playlist
    await expect(page.getByText('My Synced Playlist')).toBeVisible()
    await expect(page.getByText('Test Channel')).toBeVisible()
    await expect(page.getByText('10 tracks')).toBeVisible()
  })

  test('should navigate to playlist details', async ({ page, login }) => {
    const user = await login()
    
    // Create YouTube service
    const service = await prisma.service.upsert({
      where: { name: 'youtube' },
      update: {},
      create: {
        name: 'youtube',
        displayName: 'YouTube',
        baseUrl: 'https://youtube.com',
      },
    })

    // Create a synced playlist
    const playlist = await prisma.servicePlaylist.upsert({
      where: {
        serviceId_externalId: {
          serviceId: service.id,
          externalId: 'PLtest456'
        }
      },
      update: {},
      create: {
        serviceId: service.id,
        externalId: 'PLtest456',
        title: 'Test Playlist',
        description: 'A test playlist',
        channelId: 'test-channel-id',
        channelTitle: 'Test Channel',
        publishedAt: new Date(),
        itemCount: 5,
        ownerId: user.id,
        isActive: true,
        lastSyncedAt: new Date(),
      },
    })

    await page.goto('/music/services/youtube/synced-playlists')
    
    // Click view details button using aria-label
    await page.getByRole('link', { name: /view details for test playlist/i }).click()
    
    // Should navigate to playlist details
    await expect(page).toHaveURL(`/music/services/youtube/${playlist.id}`)
    await expect(page.getByRole('heading', { name: 'Test Playlist', level: 1 })).toBeVisible()
  })

  test('should remove synced playlist', async ({ page, login }) => {
    const user = await login()
    
    // Create YouTube service
    const service = await prisma.service.upsert({
      where: { name: 'youtube' },
      update: {},
      create: {
        name: 'youtube',
        displayName: 'YouTube',
        baseUrl: 'https://youtube.com',
      },
    })

    // Create a synced playlist
    await prisma.servicePlaylist.upsert({
      where: {
        serviceId_externalId: {
          serviceId: service.id,
          externalId: 'PLtest999'
        }
      },
      update: {},
      create: {
        serviceId: service.id,
        externalId: 'PLtest999',
        title: 'Playlist to Remove',
        description: 'This playlist will be removed',
        channelId: 'test-channel-id',
        channelTitle: 'Test Channel',
        publishedAt: new Date(),
        itemCount: 3,
        ownerId: user.id,
        isActive: true,
        lastSyncedAt: new Date(),
      },
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
