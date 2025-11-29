import { faker } from '@faker-js/faker'
import { HttpResponse, http, type HttpHandler } from 'msw'
import { YOUTUBE_SERVICE_ID } from '#app/config/youtube'
import { 
  type YouTubePlaylistItem, 
  type YouTubePlaylist,
  type YouTubeSearchResult,
  type YouTubeVideo,
  YouTubePlaylistItemSchema,
  YouTubePlaylistSchema,
  YouTubeSearchResultSchema,
  YouTubeVideoSchema
} from '#app/types/youtube-api'
import { prisma } from '#app/utils/db.server'
import { type Prisma } from '#prisma/client.js'

// Mock data constants
const DEFAULT_PLAYLIST_COUNT = 2
const DEFAULT_TRACKS_PER_PLAYLIST = 3
const TEST_CHANNEL_TITLE = 'Test Channel'
const API_PLAYLIST_ID_PREFIX = 'PLapi'

/**
 * MOCK DATA GENERATION ARCHITECTURE
 * 
 * This file implements a 5-layer mock data system:
 * 
 * LAYER 1: YouTube API Mock Generators
 * - createFakerYouTubePlaylistItem()
 * - createFakerYouTubePlaylist()
 * - createFakerYouTubeSearchResult()
 * - createFakerYouTubeVideo()
 * - Validates with Zod schemas
 * 
 * LAYER 2: Database Mock Generators  
 * - createFakerTrackData()
 * - createFakerServicePlaylistData()
 * - Creates data matching Prisma schema
 * 
 * LAYER 3: Database Record Creators
 * - createFakerTrack()
 * - createFakerServicePlaylist()
 * - createFakerPlaylistWithTracks()
 * - Actually creates database records
 * 
 * LAYER 4: MSW Handler Generators
 * - createYouTubePlaylistsHandler()
 * - createYouTubePlaylistItemsHandler()
 * - createYouTubeSearchHandler()
 * - createYouTubeVideoDetailsHandler()
 * - Dynamic API mocking per test
 * 
 * LAYER 5: Test Scenario Builders
 * - createTestScenario()
 * - Complete test setup with DB + API mocks
 * 
 * USAGE:
 * ```typescript
 * const scenario = await createTestScenario({
 *   playlistCount: 2,
 *   tracksPerPlaylist: 5
 * })
 * server.use(...scenario.handlers)
 * ```
 */

// ============================================================================
// LAYER 1: YOUTUBE API MOCK GENERATORS
// ============================================================================

export function createFakerYouTubePlaylistItem(
  playlistId: string, 
  index: number, 
  options?: {
    title?: string
    artist?: string
    videoId?: string
    duration?: number
  }
): YouTubePlaylistItem {
  const {
    title = `Test Video ${index + 1}`,
    artist = 'Test Channel',
    videoId = faker.string.alphanumeric(11),
  } = options || {}

  const item: YouTubePlaylistItem = {
    kind: 'youtube#playlistItem',
    etag: faker.string.alphanumeric(27),
    id: faker.string.alphanumeric(34),
    snippet: {
      publishedAt: faker.date.past().toISOString(),
      channelId: faker.string.alphanumeric(24),
      title,
      description: `Description for ${title}`,
      thumbnails: {
        default: { url: `https://img.youtube.com/vi/${videoId}/default.jpg` },
        medium: { url: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` },
        high: { url: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` },
      },
      channelTitle: artist,
      videoOwnerChannelTitle: artist,
      videoOwnerChannelId: faker.string.alphanumeric(24),
      playlistId,
      position: index,
      resourceId: {
        kind: 'youtube#video',
        videoId,
      },
    },
    contentDetails: {
      videoId,
      startAt: '0',
      endAt: '0',
      note: '',
      videoPublishedAt: faker.date.past().toISOString(),
    },
  }

  // Validate with Zod schema
  return YouTubePlaylistItemSchema.parse(item)
}

export function createFakerYouTubePlaylist(
  playlistId: string,
  options?: {
    title?: string
    description?: string
    itemCount?: number
    channelTitle?: string
  }
): YouTubePlaylist {
  const {
    title = 'Test Playlist',
    description = 'Test playlist description',
    itemCount = 5,
    channelTitle = 'Test Channel'
  } = options || {}

  const playlist: YouTubePlaylist = {
    kind: 'youtube#playlist',
    etag: faker.string.alphanumeric(27),
    id: playlistId,
    snippet: {
      publishedAt: faker.date.past().toISOString(),
      channelId: faker.string.alphanumeric(24),
      title,
      description,
      thumbnails: {
        default: { url: `https://img.youtube.com/vi/default/default.jpg` },
        medium: { url: `https://img.youtube.com/vi/default/mqdefault.jpg` },
        high: { url: `https://img.youtube.com/vi/default/hqdefault.jpg` },
      },
      channelTitle,
      defaultLanguage: 'en',
      localized: {
        title,
        description,
      },
    },
    contentDetails: {
      itemCount,
    },
    status: {
      privacyStatus: 'public',
    },
  }

  // Validate with Zod schema
  return YouTubePlaylistSchema.parse(playlist)
}

export function createFakerYouTubeSearchResult(
  videoId: string,
  options?: {
    title?: string
    channelTitle?: string
    description?: string
  }
): YouTubeSearchResult {
  const {
    title = faker.music.songName(),
    channelTitle = faker.person.fullName(),
    description = faker.lorem.sentence()
  } = options || {}

  const result: YouTubeSearchResult = {
    kind: 'youtube#searchResult',
    etag: faker.string.alphanumeric(27),
    id: {
      kind: 'youtube#video',
      videoId,
    },
    snippet: {
      publishedAt: faker.date.past().toISOString(),
      channelId: faker.string.alphanumeric(24),
      title,
      description,
      thumbnails: {
        default: { url: `https://img.youtube.com/vi/${videoId}/default.jpg` },
        medium: { url: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` },
        high: { url: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` },
      },
      channelTitle,
    },
  }

  // Validate with Zod schema
  return YouTubeSearchResultSchema.parse(result)
}

export function createFakerYouTubeVideo(
  videoId: string,
  options?: {
    title?: string
    channelTitle?: string
    duration?: string
    description?: string
  }
): YouTubeVideo {
  const {
    title = faker.music.songName(),
    channelTitle = faker.person.fullName(),
    duration = 'PT3M30S', // 3 minutes 30 seconds
    description = faker.lorem.sentence()
  } = options || {}

  const video: YouTubeVideo = {
    kind: 'youtube#video',
    etag: faker.string.alphanumeric(27),
    id: videoId,
    snippet: {
      publishedAt: faker.date.past().toISOString(),
      channelId: faker.string.alphanumeric(24),
      title,
      description,
      thumbnails: {
        default: { url: `https://img.youtube.com/vi/${videoId}/default.jpg` },
        medium: { url: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` },
        high: { url: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` },
      },
      channelTitle,
    },
    contentDetails: {
      duration,
      dimension: '2d',
      definition: 'hd',
      caption: 'false',
      licensedContent: false,
      projection: 'rectangular',
    },
  }

  // Validate with Zod schema
  return YouTubeVideoSchema.parse(video)
}

// ============================================================================
// LAYER 2: DATABASE MOCK GENERATORS
// ============================================================================

export function createFakerTrackData(
  serviceId: string,
  options?: {
    title?: string
    artist?: string
    duration?: number
    videoId?: string
  }
): Prisma.TrackCreateInput {
  const {
    title = faker.music.songName(),
    artist = faker.person.fullName(),
    duration = faker.number.int({ min: 120, max: 600 }),
    videoId = faker.string.alphanumeric(11)
  } = options || {}

  return {
    title,
    artist,
    album: null,
    duration,
    externalId: videoId,
    service: { connect: { id: serviceId } },
    serviceUrl: `https://youtube.com/watch?v=${videoId}`,
    thumbnailUrl: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
    releaseDate: null,
  }
}

export function createFakerServicePlaylistData(
  serviceId: string,
  options?: {
    ownerId?: string
    title?: string
    description?: string
    externalId?: string
    itemCount?: number
    channelTitle?: string
    channelId?: string
  }
): Prisma.ServicePlaylistCreateInput {
  const {
    ownerId = faker.string.alphanumeric(25), // Generate owner ID if not provided
    title = faker.music.genre() + ' Playlist',
    description = faker.lorem.sentence(),
    externalId = `PL${faker.string.alphanumeric(32)}`,
    itemCount = faker.number.int({ min: 1, max: 20 }),
    channelTitle = faker.person.fullName(),
    channelId = faker.string.alphanumeric(24)
  } = options || {}

  return {
    title,
    description,
    externalId,
    service: { connect: { id: serviceId } },
    owner: { connect: { id: ownerId } },
    itemCount,
    channelId,
    channelTitle,
    thumbnailUrl: `https://img.youtube.com/vi/default/mqdefault.jpg`,
  }
}

// ============================================================================
// LAYER 3: DATABASE RECORD CREATORS
// ============================================================================

export async function createFakerTrack(
  serviceId: string,
  options?: Parameters<typeof createFakerTrackData>[1]
): Promise<Prisma.TrackGetPayload<{}>> {
  const trackData = createFakerTrackData(serviceId, options)
  
  // Prisma handles validation
  return prisma.track.create({
    data: trackData,
  })
}

export async function createFakerServicePlaylist(
  serviceId: string,
  options?: Parameters<typeof createFakerServicePlaylistData>[1]
): Promise<Prisma.ServicePlaylistGetPayload<{}>> {
  const playlistData = createFakerServicePlaylistData(serviceId, options)
  
  // Prisma handles validation
  return prisma.servicePlaylist.create({
    data: playlistData,
  })
}

export async function createFakerPlaylistWithTracks(
  serviceId: string,
  trackCount: number,
  options?: {
    playlistOptions?: Parameters<typeof createFakerServicePlaylistData>[1]
    trackOptions?: Parameters<typeof createFakerTrackData>[1]
  }
): Promise<{ 
  playlist: Prisma.ServicePlaylistGetPayload<{}>
  tracks: Prisma.TrackGetPayload<{}>[]
  playlistTracks: Prisma.ServicePlaylistTrackGetPayload<{}>[]
}> {
  const { playlistOptions, trackOptions } = options || {}
  
  // Create playlist
  const playlist = await createFakerServicePlaylist(serviceId, playlistOptions)
  
  // Create tracks
  const tracks = await Promise.all(
    Array.from({ length: trackCount }, (_, i) =>
      createFakerTrack(serviceId, {
        ...trackOptions,
        title: `Track ${i + 1}`,
        artist: `Artist ${i + 1}`,
      })
    )
  )
  
  // Create playlist-track relationships
  const playlistTracks = await Promise.all(
    tracks.map((track, index) =>
      prisma.servicePlaylistTrack.create({
        data: {
          playlistId: playlist.id,
          trackId: track.id,
          position: index,
        },
      })
    )
  )
  
  return { playlist, tracks, playlistTracks }
}

// ============================================================================
// LAYER 4: MSW HANDLER GENERATORS
// ============================================================================

export function createYouTubePlaylistsHandler(options?: {
  userPlaylists?: YouTubePlaylist[]
  publicPlaylists?: Record<string, YouTubePlaylist>
  requireApiKey?: boolean
}): HttpHandler {
  const {
    userPlaylists = [createFakerYouTubePlaylist('PLtest')],
    publicPlaylists = {},
    requireApiKey = true
  } = options || {}

  return http.get('https://youtube.googleapis.com/youtube/v3/playlists', ({ request }) => {
    const url = new URL(request.url)
    const apiKey = url.searchParams.get('key')
    const mine = url.searchParams.get('mine')
    const isUserPlaylistsRequest = mine === 'true'
    const playlistId = url.searchParams.get('id')
    
    // Handle malformed URLs with duplicate query parameters
    const isUserPlaylistsRequestFallback = request.url.includes('mine=true')
    
    // User playlists request (mine=true) - requires OAuth
    if (isUserPlaylistsRequest || isUserPlaylistsRequestFallback) {
      return HttpResponse.json({
        kind: 'youtube#playlistListResponse',
        etag: 'mock-etag',
        pageInfo: { totalResults: userPlaylists.length, resultsPerPage: userPlaylists.length },
        items: userPlaylists,
      })
    }
    
    // Public playlist request (id=playlistId)
    if (playlistId) {
      const playlist = publicPlaylists[playlistId] || createFakerYouTubePlaylist(playlistId)
      return HttpResponse.json({
        kind: 'youtube#playlistListResponse',
        etag: 'mock-etag',
        pageInfo: { totalResults: 1, resultsPerPage: 1 },
        items: [playlist],
      })
    }
    
    // API key validation
    if (requireApiKey && !apiKey) {
      return HttpResponse.json({
        error: {
          code: 400,
          message: 'API key not valid. Please pass a valid API key.',
          errors: [{ message: 'API key not valid', domain: 'global', reason: 'badRequest' }]
        }
      }, { status: 400 })
    }
    
    // Default: empty response
    return HttpResponse.json({
      kind: 'youtube#playlistListResponse',
      etag: 'mock-etag',
      pageInfo: { totalResults: 0, resultsPerPage: 0 },
      items: []
    })
  })
}

export function createYouTubePlaylistItemsHandler(options?: {
  playlistItems?: Record<string, YouTubePlaylistItem[]>
  requireApiKey?: boolean
}): HttpHandler {
  const {
    playlistItems = {},
    requireApiKey = true
  } = options || {}

  return http.get('https://youtube.googleapis.com/youtube/v3/playlistItems', ({ request }) => {
    const url = new URL(request.url)
    const apiKey = url.searchParams.get('key')
    const playlistId = url.searchParams.get('playlistId')
    
    // API key validation
    if (requireApiKey && !apiKey) {
      return HttpResponse.json({
        error: {
          code: 400,
          message: 'API key not valid. Please pass a valid API key.',
          errors: [{ message: 'API key not valid', domain: 'global', reason: 'badRequest' }]
        }
      }, { status: 400 })
    }
    
    // Return items for the requested playlist
    if (playlistId && playlistItems[playlistId]) {
      return HttpResponse.json({
        kind: 'youtube#playlistItemListResponse',
        etag: 'mock-etag',
        pageInfo: { totalResults: playlistItems[playlistId].length, resultsPerPage: playlistItems[playlistId].length },
        items: playlistItems[playlistId],
      })
    }
    
    // Return empty result for unknown playlists
    return HttpResponse.json({
      kind: 'youtube#playlistItemListResponse',
      etag: 'mock-etag',
      pageInfo: { totalResults: 0, resultsPerPage: 0 },
      items: []
    })
  })
}

export function createYouTubeSearchHandler(options?: {
  searchResults?: YouTubeSearchResult[]
  requireApiKey?: boolean
}): HttpHandler {
  const {
    searchResults = [],
    requireApiKey = true
  } = options || {}

  return http.get('https://youtube.googleapis.com/youtube/v3/search', ({ request }) => {
    const url = new URL(request.url)
    const apiKey = url.searchParams.get('key')
    
    // API key validation
    if (requireApiKey && !apiKey) {
      return HttpResponse.json({
        error: {
          code: 400,
          message: 'API key not valid. Please pass a valid API key.',
          errors: [{ message: 'API key not valid', domain: 'global', reason: 'badRequest' }]
        }
      }, { status: 400 })
    }
    
    return HttpResponse.json({
      kind: 'youtube#searchListResponse',
      etag: 'mock-etag',
      pageInfo: { totalResults: searchResults.length, resultsPerPage: searchResults.length },
      items: searchResults,
    })
  })
}

export function createYouTubeVideoDetailsHandler(options?: {
  videoDetails?: Record<string, YouTubeVideo>
  requireApiKey?: boolean
}): HttpHandler {
  const {
    videoDetails = {},
    requireApiKey = true
  } = options || {}

  return http.get('https://youtube.googleapis.com/youtube/v3/videos', ({ request }) => {
    const url = new URL(request.url)
    const apiKey = url.searchParams.get('key')
    const videoIds = url.searchParams.get('id')
    
    // API key validation
    if (requireApiKey && !apiKey) {
      return HttpResponse.json({
        error: {
          code: 400,
          message: 'API key not valid. Please pass a valid API key.',
          errors: [{ message: 'API key not valid', domain: 'global', reason: 'badRequest' }]
        }
      }, { status: 400 })
    }
    
    // Return video details for requested IDs
    if (videoIds) {
      const ids = videoIds.split(',')
      const videos = ids.map(id => videoDetails[id] || createFakerYouTubeVideo(id))
      
      return HttpResponse.json({
        kind: 'youtube#videoListResponse',
        etag: 'mock-etag',
        pageInfo: { totalResults: videos.length, resultsPerPage: videos.length },
        items: videos,
      })
    }
    
    // Return empty result
    return HttpResponse.json({
      kind: 'youtube#videoListResponse',
      etag: 'mock-etag',
      pageInfo: { totalResults: 0, resultsPerPage: 0 },
      items: []
    })
  })
}

export function createYouTubeAPIHandlers(options?: {
  userPlaylists?: YouTubePlaylist[]
  publicPlaylists?: Record<string, YouTubePlaylist>
  playlistItems?: Record<string, YouTubePlaylistItem[]>
  searchResults?: YouTubeSearchResult[]
  videoDetails?: Record<string, YouTubeVideo>
  requireApiKey?: boolean
}): HttpHandler[] {
  return [
    createYouTubePlaylistsHandler(options),
    createYouTubePlaylistItemsHandler(options),
    createYouTubeSearchHandler(options),
    createYouTubeVideoDetailsHandler(options),
  ]
}

// ============================================================================
// LAYER 5: TEST SCENARIO BUILDERS (Ultra-Simple)
// ============================================================================

/**
 * Test scenario options for creating mock data
 */
export interface TestScenarioOptions {
  userId?: string
  playlistCount?: number
  tracksPerPlaylist?: number
  serviceId?: string
}

/**
 * Creates a complete test scenario with user, playlists, and API mocks
 * 
 * @deprecated Use Playwright fixtures instead (insertNewPlaylist, insertYouTubeConnection)
 * This function creates MSW handlers that are not needed for E2E tests.
 * Server-side mocks (youtube.server.ts) handle API mocking automatically.
 * 
 * For E2E tests: Use fixtures
 * For unit tests: Use the individual mock generators directly
 * 
 * @param options - Configuration options for the test scenario
 * @returns Complete test scenario with user, playlists, and MSW handlers
 */
export async function createTestScenario(options: TestScenarioOptions = {}) {
  const {
    userId = faker.string.alphanumeric(25),
    playlistCount = DEFAULT_PLAYLIST_COUNT,
    tracksPerPlaylist = DEFAULT_TRACKS_PER_PLAYLIST,
    serviceId = YOUTUBE_SERVICE_ID
  } = options

  const user = await ensureTestUser(userId)
  const playlists = await createTestPlaylists(user.id, serviceId, playlistCount, tracksPerPlaylist)
  const { userPlaylists, playlistItems } = createApiMockData(playlists)
  const handlers = createMSWHandlers(userPlaylists, playlistItems)
  
  return {
    user,
    playlists,
    serviceId,
    handlers,
    userPlaylists,
    playlistItems
  }
}

/**
 * Ensures a test user exists, creating one if necessary
 * 
 * @param userId - Optional user ID to use
 * @returns The user record
 */
async function ensureTestUser(userId?: string) {
  if (userId) {
    // Try to find existing user first
    const existingUser = await prisma.user.findUnique({ where: { id: userId } })
    if (existingUser) {
      return existingUser
    }
    
    // Create user with provided ID
    return await prisma.user.create({
      data: {
        id: userId,
        email: faker.internet.email(),
        username: faker.internet.userName(),
        name: faker.person.fullName(),
      }
    })
  }
  
  // Create new user with generated ID
  return await prisma.user.create({
    data: {
      email: faker.internet.email(),
      username: faker.internet.userName(),
      name: faker.person.fullName(),
    }
  })
}

/**
 * Creates test playlists with tracks for a user
 * 
 * @param userId - The user ID to create playlists for
 * @param serviceId - The service ID to use
 * @param playlistCount - Number of playlists to create
 * @param tracksPerPlaylist - Number of tracks per playlist
 * @returns Array of playlists with tracks
 */
async function createTestPlaylists(
  userId: string, 
  serviceId: string, 
  playlistCount: number, 
  tracksPerPlaylist: number
) {
  return await Promise.all(
    Array.from({ length: playlistCount }, (_, i) =>
      createFakerPlaylistWithTracks(
        serviceId,
        tracksPerPlaylist,
        {
          playlistOptions: {
            ownerId: userId,
            title: `Test Playlist ${i + 1}`,
            description: `Description for playlist ${i + 1}`,
            channelTitle: TEST_CHANNEL_TITLE
          }
        }
      )
    )
  )
}

/**
 * Creates API mock data corresponding to database playlists
 * 
 * @param playlists - Database playlists to create API mocks for
 * @returns API mock data for playlists and playlist items
 */
function createApiMockData(playlists: any[]) {
  const userPlaylists = playlists.map((playlist, index) => 
    createFakerYouTubePlaylist(`${API_PLAYLIST_ID_PREFIX}${index + 1}`, {
      title: playlist.playlist.title,
      description: playlist.playlist.description || undefined,
      itemCount: playlist.playlist.itemCount,
      channelTitle: 'Test Channel'
    })
  )
  
  const playlistItems: Record<string, YouTubePlaylistItem[]> = {}
  playlists.forEach((playlist, index) => {
    const apiPlaylistId = `${API_PLAYLIST_ID_PREFIX}${index + 1}`
    playlistItems[apiPlaylistId] = playlist.tracks.map((track: any, trackIndex: number) =>
      createFakerYouTubePlaylistItem(apiPlaylistId, trackIndex, {
        title: track.title,
        artist: track.artist,
        videoId: track.serviceProviderId || undefined
      })
    )
  })
  
  return { userPlaylists, playlistItems }
}

/**
 * Creates MSW handlers for the test scenario
 * 
 * @param userPlaylists - API mock playlists
 * @param playlistItems - API mock playlist items
 * @returns MSW handlers for the test scenario
 */
function createMSWHandlers(userPlaylists: any[], playlistItems: Record<string, YouTubePlaylistItem[]>) {
  return createYouTubeAPIHandlers({
    userPlaylists,
    playlistItems,
    requireApiKey: false // OAuth requests don't need API key
  })
}
