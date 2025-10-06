import { HttpResponse, http, type HttpHandler } from 'msw'

// Constants
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3'
const API_KEY_ERROR_MESSAGE = 'API key not valid. Please pass a valid API key.'

/**
 * Creates a YouTube API key validation error response for MSW mocks
 * @returns HttpResponse with 400 status and API key error
 */
const createApiKeyError = () => HttpResponse.json(
  {
    error: {
      code: 400,
      message: API_KEY_ERROR_MESSAGE,
      errors: [
        {
          message: API_KEY_ERROR_MESSAGE,
          domain: 'global',
          reason: 'badRequest',
        },
      ],
    },
  },
  { status: 400 }
)

// Mock YouTube video data for testing
const mockYouTubeVideo = {
  id: 'dQw4w9WgXcQ',
  snippet: {
    title: 'Rick Astley - Never Gonna Give You Up (Official Video)',
    channelTitle: 'RickAstleyVEVO',
    publishedAt: '2009-10-25T06:57:33Z',
    thumbnails: {
      default: {
        url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg',
        width: 120,
        height: 90,
      },
      medium: {
        url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
        width: 320,
        height: 180,
      },
      high: {
        url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
        width: 480,
        height: 360,
      },
    },
  },
  contentDetails: {
    duration: 'PT3M33S', // 3 minutes 33 seconds
  },
}

// Mock search results
const mockSearchResults = {
  items: [
    {
      id: {
        videoId: 'dQw4w9WgXcQ',
      },
      snippet: {
        title: 'Rick Astley - Never Gonna Give You Up (Official Video)',
        channelTitle: 'RickAstleyVEVO',
        publishedAt: '2009-10-25T06:57:33Z',
        thumbnails: {
          default: {
            url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg',
            width: 120,
            height: 90,
          },
          medium: {
            url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
            width: 320,
            height: 180,
          },
          high: {
            url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
            width: 480,
            height: 360,
          },
        },
      },
    },
  ],
}

export const handlers: Array<HttpHandler> = [
  // Mock YouTube API search endpoint
  http.get(`${YOUTUBE_API_BASE}/search`, ({ request }) => {
    const url = new URL(request.url)
    const apiKey = url.searchParams.get('key')
    
    // Accept any API key when mocks are enabled (including 'mock-key')
    if (!apiKey) {
      return createApiKeyError()
    }

    return HttpResponse.json(mockSearchResults)
  }),

  // Mock YouTube API videos endpoint (for getting video details)
  http.get(`${YOUTUBE_API_BASE}/videos`, ({ request }) => {
    const url = new URL(request.url)
    const apiKey = url.searchParams.get('key')
    const videoIds = url.searchParams.get('id')
    
    if (!apiKey) {
      return createApiKeyError()
    }

    // Return mock video data for the requested video ID
    if (videoIds === 'dQw4w9WgXcQ') {
      return HttpResponse.json({
        items: [mockYouTubeVideo],
      })
    }

    // Return empty result for unknown video IDs
    return HttpResponse.json({
      items: [],
    })
  }),

  // Mock YouTube API playlists endpoint
  http.get(`${YOUTUBE_API_BASE}/playlists`, ({ request }) => {
    const url = new URL(request.url)
    const apiKey = url.searchParams.get('key')
    
    if (!apiKey) {
      return createApiKeyError()
    }

    return HttpResponse.json({
      items: [
        {
          id: 'PLtest123',
          snippet: {
            title: 'Test Playlist',
            description: 'A test playlist',
            channelId: 'UCtest123',
            channelTitle: 'Test Channel',
            publishedAt: '2023-01-01T00:00:00Z',
            thumbnails: {
              default: {
                url: 'https://i.ytimg.com/vi/test/default.jpg',
                width: 120,
                height: 90,
              },
            },
          },
          contentDetails: {
            itemCount: 10,
          },
        },
      ],
    })
  }),

  // Mock YouTube API playlistItems endpoint
  http.get(`${YOUTUBE_API_BASE}/playlistItems`, ({ request }) => {
    const url = new URL(request.url)
    const apiKey = url.searchParams.get('key')
    
    if (!apiKey) {
      return createApiKeyError()
    }

    return HttpResponse.json({
      items: [
        {
          id: 'PLtest123-item1',
          snippet: {
            title: 'Test Video 1',
            description: 'A test video',
            channelTitle: 'Test Channel',
            publishedAt: '2023-01-01T00:00:00Z',
            thumbnails: {
              default: {
                url: 'https://i.ytimg.com/vi/test1/default.jpg',
                width: 120,
                height: 90,
              },
            },
            resourceId: {
              videoId: 'test1',
            },
          },
        },
      ],
    })
  }),
]
