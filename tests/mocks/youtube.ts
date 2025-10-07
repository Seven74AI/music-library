import { HttpResponse, http, type HttpHandler } from 'msw'

// Constants
const YOUTUBE_API_BASE_URL = 'https://youtube.googleapis.com/youtube/v3'
const YOUTUBE_API_KEY_ERROR_MESSAGE = 'API key not valid. Please pass a valid API key.'

// Type definitions for error responses
interface YouTubeErrorResponse {
  error: {
    code: number
    message: string
    errors: Array<{
      message: string
      domain: string
      reason: string
    }>
  }
}

/**
 * Creates a configurable YouTube API error response for MSW mocks
 * @param code - HTTP status code
 * @param message - Error message
 * @param reason - Error reason (default: 'badRequest')
 * @returns HttpResponse with specified error details
 */
const createYouTubeError = (code: number, message: string, reason = 'badRequest'): HttpResponse<YouTubeErrorResponse> => 
  HttpResponse.json(
    {
      error: {
        code,
        message,
        errors: [{ message, domain: 'global', reason }],
      },
    } satisfies YouTubeErrorResponse,
    { status: code }
  )

/**
 * Creates a YouTube API key validation error response for MSW mocks
 * @returns HttpResponse with 400 status and API key error
 */
const createApiKeyError = () => createYouTubeError(400, YOUTUBE_API_KEY_ERROR_MESSAGE)

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
  // Generic YouTube API mock to catch all requests
  http.get('https://youtube.googleapis.com/youtube/v3/*', ({ request }) => {
    console.log('🎭 MSW: Generic YouTube API request intercepted:', request.url)
    console.log('🎭 MSW: Request method:', request.method)
    console.log('🎭 MSW: Request headers:', Object.fromEntries(request.headers.entries()))
    return HttpResponse.json({ error: 'Generic mock - not implemented' }, { status: 500 })
  }),

  // Mock YouTube API search endpoint
  http.get(`${YOUTUBE_API_BASE_URL}/search`, ({ request }) => {
    const url = new URL(request.url)
    const apiKey = url.searchParams.get('key')
    
    // Accept any API key when mocks are enabled (including 'mock-key')
    if (!apiKey) {
      return createApiKeyError()
    }

    return HttpResponse.json(mockSearchResults)
  }),

  // Mock YouTube API videos endpoint (for getting video details)
  http.get(`${YOUTUBE_API_BASE_URL}/videos`, ({ request }) => {
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

  // Mock YouTube API playlists endpoint (OAuth and API key)
  http.get(`${YOUTUBE_API_BASE_URL}/playlists`, ({ request }) => {
    const url = new URL(request.url)
    const apiKey = url.searchParams.get('key')
    const mine = url.searchParams.get('mine')
    
    console.log('🎭 MSW: Received playlists request:', {
      url: request.url,
      apiKey: apiKey ? 'present' : 'missing',
      mine: mine || 'missing'
    })
    
    // For OAuth requests (mine=true), don't require API key
    if (mine === 'true') {
      console.log('🎭 MSW: Mocking OAuth playlists request')
      return HttpResponse.json({
        kind: 'youtube#playlistListResponse',
        etag: 'mockEtag123',
        pageInfo: {
          totalResults: 2,
          resultsPerPage: 25
        },
        items: [
          {
            kind: 'youtube#playlist',
            etag: 'itemEtag1',
            id: 'PLtest123',
            snippet: {
              publishedAt: '2023-01-01T12:00:00Z',
              channelId: 'UCtest123',
              title: 'My Test Playlist',
              description: 'A test playlist for testing',
              thumbnails: {
                default: { 
                  url: 'https://example.com/thumb1.jpg',
                  width: 120,
                  height: 90
                },
                medium: { 
                  url: 'https://example.com/thumb1-medium.jpg',
                  width: 320,
                  height: 180
                },
                high: { 
                  url: 'https://example.com/thumb1-high.jpg',
                  width: 480,
                  height: 360
                }
              },
              channelTitle: 'Test Channel',
              privacyStatus: 'public'
            },
            contentDetails: {
              itemCount: 5
            }
          },
          {
            kind: 'youtube#playlist',
            etag: 'itemEtag2',
            id: 'PLtest456',
            snippet: {
              publishedAt: '2023-01-02T12:00:00Z',
              channelId: 'UCtest456',
              title: 'Another Test Playlist',
              description: 'Another test playlist',
              thumbnails: {
                default: { 
                  url: 'https://example.com/thumb2.jpg',
                  width: 120,
                  height: 90
                }
              },
              channelTitle: 'Another Channel',
              privacyStatus: 'public'
            },
            contentDetails: {
              itemCount: 10
            }
          }
        ]
      })
    }
    
    // For API key requests, require API key
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

  // Mock YouTube API playlistItems endpoint (OAuth and API key)
  http.get(`${YOUTUBE_API_BASE_URL}/playlistItems`, ({ request }) => {
    const url = new URL(request.url)
    const apiKey = url.searchParams.get('key')
    
    // For OAuth requests, don't require API key
    if (!apiKey) {
      console.log('🎭 MSW: Mocking OAuth playlistItems request')
      return HttpResponse.json({
        kind: 'youtube#playlistItemListResponse',
        etag: 'mockEtag789',
        pageInfo: {
          totalResults: 2,
          resultsPerPage: 25
        },
        items: [
          {
            kind: 'youtube#playlistItem',
            etag: 'itemEtag1',
            id: 'PLI123',
            snippet: {
              publishedAt: '2023-01-01T12:00:00Z',
              channelId: 'UCtest123',
              title: 'Test Video 1',
              description: 'First test video',
              thumbnails: {
                default: {
                  url: 'https://example.com/video1-thumb.jpg',
                  width: 120,
                  height: 90
                }
              },
              channelTitle: 'Test Channel',
              videoOwnerChannelTitle: 'Test Channel',
              playlistId: 'PLtest123',
              position: 0,
              resourceId: {
                kind: 'youtube#video',
                videoId: 'dQw4w9WgXcQ'
              }
            },
            contentDetails: {
              videoId: 'dQw4w9WgXcQ',
              videoPublishedAt: '2023-01-01T12:00:00Z'
            }
          },
          {
            kind: 'youtube#playlistItem',
            etag: 'itemEtag2',
            id: 'PLI456',
            snippet: {
              publishedAt: '2023-01-02T12:00:00Z',
              channelId: 'UCtest123',
              title: 'Test Video 2',
              description: 'Second test video',
              thumbnails: {
                default: {
                  url: 'https://example.com/video2-thumb.jpg',
                  width: 120,
                  height: 90
                }
              },
              channelTitle: 'Test Channel',
              videoOwnerChannelTitle: 'Test Channel',
              playlistId: 'PLtest123',
              position: 1,
              resourceId: {
                kind: 'youtube#video',
                videoId: 'dQw4w9WgXcR'
              }
            },
            contentDetails: {
              videoId: 'dQw4w9WgXcR',
              videoPublishedAt: '2023-01-02T12:00:00Z'
            }
          }
        ]
      })
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
