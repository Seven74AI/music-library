import { google } from 'googleapis'
import { z } from 'zod'

// YouTube API response schemas
const YouTubeSearchResultSchema = z.object({
  id: z.object({
    kind: z.string(),
    videoId: z.string(),
  }),
  snippet: z.object({
    title: z.string(),
    channelTitle: z.string(),
    publishedAt: z.string(),
    thumbnails: z.object({
      default: z.object({
        url: z.string(),
      }).optional(),
      medium: z.object({
        url: z.string(),
      }).optional(),
      high: z.object({
        url: z.string(),
      }).optional(),
    }),
  }),
})

const YouTubeVideoDetailsSchema = z.object({
  id: z.string(),
  snippet: z.object({
    title: z.string(),
    channelTitle: z.string(),
    publishedAt: z.string(),
    thumbnails: z.object({
      default: z.object({
        url: z.string(),
      }).optional(),
      medium: z.object({
        url: z.string(),
      }).optional(),
      high: z.object({
        url: z.string(),
      }).optional(),
    }),
  }),
  contentDetails: z.object({
    duration: z.string(), // ISO 8601 duration format
  }),
})

const YouTubeSearchResponseSchema = z.object({
  items: z.array(YouTubeSearchResultSchema),
  nextPageToken: z.string().optional(),
  pageInfo: z.object({
    totalResults: z.number(),
    resultsPerPage: z.number(),
  }),
})

const YouTubeVideoDetailsResponseSchema = z.object({
  items: z.array(YouTubeVideoDetailsSchema),
})

export type YouTubeSearchResult = z.infer<typeof YouTubeSearchResultSchema>
export type YouTubeVideoDetails = z.infer<typeof YouTubeVideoDetailsSchema>
export type YouTubeSearchResponse = z.infer<typeof YouTubeSearchResponseSchema>
export type YouTubeVideoDetailsResponse = z.infer<typeof YouTubeVideoDetailsResponseSchema>

/**
 * Convert ISO 8601 duration to seconds
 * PT4M13S -> 253 seconds
 */
function parseDuration(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return 0
  
  const hours = parseInt(match[1] || '0', 10)
  const minutes = parseInt(match[2] || '0', 10)
  const seconds = parseInt(match[3] || '0', 10)
  
  return hours * 3600 + minutes * 60 + seconds
}


export class YouTubeAPIError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number
  ) {
    super(message)
    this.name = 'YouTubeAPIError'
  }
}

/**
 * Search YouTube videos with enhanced error handling
 */
export async function searchYouTubeVideos(query: string, maxResults = 10): Promise<{
  id: string
  title: string
  artist: string
  duration: number
  thumbnailUrl: string
  serviceUrl: string
  publishedAt: string
}[]> {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey && !process.env.MOCKS) {
    throw new YouTubeAPIError('YouTube API key is not configured', 'NO_API_KEY')
  }

  const youtube = google.youtube({
    version: 'v3',
    auth: apiKey || 'mock-key', // Use a mock key when mocks are enabled
  })

  try {
    const response = await youtube.search.list({
      part: ['snippet'],
      q: query,
      type: ['video'],
      maxResults,
      order: 'relevance',
    })

    const searchData = YouTubeSearchResponseSchema.parse(response.data)
    
    if (searchData.items.length === 0) {
      return []
    }
    
    // Get detailed video information including duration
    const videoIds = searchData.items.map(item => item.id.videoId)
    const videoDetailsResponse = await youtube.videos.list({
      part: ['snippet', 'contentDetails'],
      id: videoIds,
    })

    const videoDetails = YouTubeVideoDetailsResponseSchema.parse(videoDetailsResponse.data)
    
    return videoDetails.items
      .filter((video): video is NonNullable<typeof video> => video != null)
      .map(video => {
        const duration = parseDuration(video.contentDetails.duration)
        const thumbnail = video.snippet.thumbnails.high?.url || 
                        video.snippet.thumbnails.medium?.url || 
                        video.snippet.thumbnails.default?.url || 
                        ''

        return {
          id: video.id,
          title: video.snippet.title,
          artist: video.snippet.channelTitle,
          duration,
          thumbnailUrl: thumbnail,
          serviceUrl: `https://youtube.com/watch?v=${video.id}`,
          publishedAt: video.snippet.publishedAt,
        }
      })
  } catch (error) {
    console.error('YouTube API error:', error)
    
    if (error instanceof Error) {
      if (error.message.includes('quota')) {
        throw new YouTubeAPIError('YouTube API quota exceeded. Please try again later.', 'QUOTA_EXCEEDED', 429)
      }
      if (error.message.includes('key')) {
        throw new YouTubeAPIError('Invalid YouTube API key', 'INVALID_API_KEY', 401)
      }
      if (error.message.includes('network') || error.message.includes('timeout')) {
        throw new YouTubeAPIError('Network error. Please check your connection and try again.', 'NETWORK_ERROR', 503)
      }
    }
    
    throw new YouTubeAPIError('Failed to search YouTube videos. Please try again.', 'SEARCH_FAILED', 500)
  }
}

/**
 * Get YouTube video details by ID with enhanced error handling
 */
export async function getYouTubeVideoDetails(videoId: string): Promise<{
  id: string
  title: string
  artist: string
  duration: number
  thumbnailUrl: string
  serviceUrl: string
  publishedAt: string
}> {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey && !process.env.MOCKS) {
    throw new YouTubeAPIError('YouTube API key is not configured', 'NO_API_KEY')
  }

  const youtube = google.youtube({
    version: 'v3',
    auth: apiKey || 'mock-key', // Use a mock key when mocks are enabled
  })

  try {
    const response = await youtube.videos.list({
      part: ['snippet', 'contentDetails'],
      id: [videoId],
    })

    const videoData = YouTubeVideoDetailsResponseSchema.parse(response.data)
    
    if (videoData.items.length === 0) {
      throw new YouTubeAPIError('Video not found', 'VIDEO_NOT_FOUND', 404)
    }

    const video = videoData.items[0]
    if (!video) {
      throw new YouTubeAPIError('Video not found', 'VIDEO_NOT_FOUND', 404)
    }
    
    const duration = parseDuration(video.contentDetails.duration)
    const thumbnail = video.snippet.thumbnails.high?.url || 
                    video.snippet.thumbnails.medium?.url || 
                    video.snippet.thumbnails.default?.url || 
                    ''

    return {
      id: video.id,
      title: video.snippet.title,
      artist: video.snippet.channelTitle,
      duration,
      thumbnailUrl: thumbnail,
      serviceUrl: `https://youtube.com/watch?v=${video.id}`,
      publishedAt: video.snippet.publishedAt,
    }
  } catch (error) {
    console.error('YouTube API error:', error)
    
    if (error instanceof YouTubeAPIError) {
      throw error
    }
    
    if (error instanceof Error) {
      if (error.message.includes('quota')) {
        throw new YouTubeAPIError('YouTube API quota exceeded. Please try again later.', 'QUOTA_EXCEEDED', 429)
      }
      if (error.message.includes('key')) {
        throw new YouTubeAPIError('Invalid YouTube API key', 'INVALID_API_KEY', 401)
      }
      if (error.message.includes('network') || error.message.includes('timeout')) {
        throw new YouTubeAPIError('Network error. Please check your connection and try again.', 'NETWORK_ERROR', 503)
      }
    }
    
    throw new YouTubeAPIError('Failed to get YouTube video details. Please try again.', 'FETCH_FAILED', 500)
  }
}
