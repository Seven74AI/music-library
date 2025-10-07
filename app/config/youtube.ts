/**
 * YouTube configuration and constants
 * Centralized configuration for YouTube-related functionality
 */

// YouTube API constants
export const YOUTUBE_API_LIMITS = {
  MAX_SEARCH_RESULTS: 50,
  MIN_SEARCH_RESULTS: 1,
  DEFAULT_SEARCH_RESULTS: 10,
} as const

// YouTube URLs and constants
export const YOUTUBE_CONSTANTS = {
  BASE_URL: 'https://youtube.com',
  WATCH_URL: 'https://youtube.com/watch?v=',
  API_VERSION: 'v3',
  MOCK_API_KEY: 'mock-key',
  MOCK_DURATION: 'PT3M33S', // 3 minutes 33 seconds
} as const

// Mock data constants
export const MOCK_DATA = {
  VIDEO_TITLE: 'Never Gonna Give You Up',
  VIDEO_ARTIST: 'Rick Astley',
  VIDEO_PUBLISHED_AT: '2009-10-25T06:57:33Z',
  CHANNEL_TITLE: 'Mock Channel',
  PLAYLIST_TITLE: 'My Test Playlist',
  PLAYLIST_DESCRIPTION: 'A test playlist for testing',
  THUMBNAIL_BASE_URL: 'https://example.com/thumb',
} as const

/**
 * Generate mock video data for testing
 */
export function createMockVideoData(videoId: string, options?: {
  title?: string
  artist?: string
  publishedAt?: string
  thumbnailSuffix?: string
}) {
  const {
    title = MOCK_DATA.VIDEO_TITLE,
    artist = MOCK_DATA.VIDEO_ARTIST,
    publishedAt = MOCK_DATA.VIDEO_PUBLISHED_AT,
    thumbnailSuffix = 'default'
  } = options || {}

  return {
    id: videoId,
    snippet: {
      title,
      channelTitle: artist,
      publishedAt,
      thumbnails: {
        default: { 
          url: `${MOCK_DATA.THUMBNAIL_BASE_URL}-${thumbnailSuffix}.jpg`,
          width: 120,
          height: 90
        },
        medium: { 
          url: `${MOCK_DATA.THUMBNAIL_BASE_URL}-${thumbnailSuffix}-medium.jpg`,
          width: 320,
          height: 180
        },
        high: { 
          url: `${MOCK_DATA.THUMBNAIL_BASE_URL}-${thumbnailSuffix}-high.jpg`,
          width: 480,
          height: 360
        }
      }
    },
    contentDetails: {
      duration: YOUTUBE_CONSTANTS.MOCK_DURATION
    }
  }
}

/**
 * Generate mock playlist data for testing
 */
export function createMockPlaylistData(playlistId: string, options?: {
  title?: string
  description?: string
  channelTitle?: string
  channelId?: string
  itemCount?: number
  thumbnailSuffix?: string
}) {
  const {
    title = MOCK_DATA.PLAYLIST_TITLE,
    description = MOCK_DATA.PLAYLIST_DESCRIPTION,
    channelTitle = 'Test Channel',
    channelId = 'UCtest123',
    itemCount = 5,
    thumbnailSuffix = '1'
  } = options || {}

  return {
    kind: 'youtube#playlist',
    etag: `mockEtag${playlistId}`,
    id: playlistId,
    snippet: {
      publishedAt: '2023-01-01T12:00:00Z',
      channelId,
      title,
      description,
      thumbnails: {
        default: { 
          url: `${MOCK_DATA.THUMBNAIL_BASE_URL}${thumbnailSuffix}.jpg`,
          width: 120,
          height: 90
        },
        medium: { 
          url: `${MOCK_DATA.THUMBNAIL_BASE_URL}${thumbnailSuffix}-medium.jpg`,
          width: 320,
          height: 180
        },
        high: { 
          url: `${MOCK_DATA.THUMBNAIL_BASE_URL}${thumbnailSuffix}-high.jpg`,
          width: 480,
          height: 360
        }
      },
      channelTitle
    },
    contentDetails: {
      itemCount
    }
  }
}

/**
 * Generate mock playlist item data for testing
 */
export function createMockPlaylistItem(playlistId: string, index: number, options?: {
  title?: string
  artist?: string
  thumbnailSuffix?: string
}) {
  const {
    title = `Test Video ${index + 1}`,
    artist = 'Test Channel',
    thumbnailSuffix = `${index + 1}`
  } = options || {}

  return {
    kind: 'youtube#playlistItem',
    etag: `itemEtag${index + 1}`,
    id: `playlistItem${index + 1}`,
    snippet: {
      publishedAt: '2023-01-01T12:00:00Z',
      channelId: 'UCtest123',
      title,
      description: `Description for ${title}`,
      thumbnails: {
        default: { 
          url: `${MOCK_DATA.THUMBNAIL_BASE_URL}${thumbnailSuffix}.jpg`,
          width: 120,
          height: 90
        },
        medium: { 
          url: `${MOCK_DATA.THUMBNAIL_BASE_URL}${thumbnailSuffix}-medium.jpg`,
          width: 320,
          height: 180
        },
        high: { 
          url: `${MOCK_DATA.THUMBNAIL_BASE_URL}${thumbnailSuffix}-high.jpg`,
          width: 480,
          height: 360
        }
      },
      channelTitle: artist,
      videoOwnerChannelTitle: artist,
      videoOwnerChannelId: 'UCtest123',
      playlistId: playlistId,
      position: index,
      resourceId: {
        kind: 'youtube#video',
        videoId: `testVideo${index + 1}`
      }
    },
    contentDetails: {
      videoId: `testVideo${index + 1}`,
      startAt: '0',
      endAt: '0',
      note: '',
      videoPublishedAt: '2023-01-01T12:00:00Z'
    }
  }
}

/**
 * Mock Manager for handling test environment
 */
export class MockManager {
  /**
   * Check if mocks are enabled
   */
  static isEnabled(): boolean {
    const isEnabled = process.env.MOCKS === 'true'
    console.log(`MockManager.isEnabled(): ${isEnabled}, MOCKS env: ${process.env.MOCKS}`)
    return isEnabled
  }

  /**
   * Log mock activity (only in test environment)
   */
  static log(message: string): void {
    if (this.isEnabled()) {
      console.log(`🎭 ${message}`)
    }
  }

  /**
   * Get API key (mock or real)
   */
  static getApiKey(): string | undefined {
    if (this.isEnabled()) {
      return YOUTUBE_CONSTANTS.MOCK_API_KEY
    }
    return process.env.YOUTUBE_API_KEY
  }

  /**
   * Check if API key is required
   */
  static isApiKeyRequired(): boolean {
    return !this.isEnabled()
  }
}
