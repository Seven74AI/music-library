import { google } from 'googleapis'
import { 
  YOUTUBE_API_LIMITS, 
  YOUTUBE_CONSTANTS, 
  MOCK_DATA, 
  MockManager,
  createMockVideoData
} from '#app/config/youtube'
import { 
  YouTubeSearchResponseSchema, 
  YouTubeVideoDetailsResponseSchema
} from '#app/types/youtube'
import { 
  YouTubeAPIError, 
  YouTubeValidationError, 
  YouTubeNetworkError, 
  YouTubeQuotaError, 
  YouTubeAuthError, 
  YouTubeNotFoundError,
  YOUTUBE_ERROR_CODES 
} from '#app/utils/youtube-errors'
import { 
  parseDuration, 
  transformVideoData, 
  type VideoData 
} from '#app/utils/youtube-utils'

/**
 * Searches for YouTube videos based on a query string
 * @param query - The search query string
 * @param maxResults - Maximum number of results to return (default: 10)
 * @returns Promise resolving to array of video data
 * @throws YouTubeAPIError when API key is required but not configured, or when parameters are invalid
 */
export async function searchYouTubeVideos(query: string, maxResults = YOUTUBE_API_LIMITS.DEFAULT_SEARCH_RESULTS): Promise<VideoData[]> {
  // Input validation
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    throw new YouTubeValidationError('Query parameter is required and must be a non-empty string', 'query')
  }
  
  if (maxResults < YOUTUBE_API_LIMITS.MIN_SEARCH_RESULTS || maxResults > YOUTUBE_API_LIMITS.MAX_SEARCH_RESULTS) {
    throw new YouTubeValidationError(
      `maxResults must be between ${YOUTUBE_API_LIMITS.MIN_SEARCH_RESULTS} and ${YOUTUBE_API_LIMITS.MAX_SEARCH_RESULTS}`,
      'maxResults'
    )
  }

  const apiKey = MockManager.getApiKey()
  
  if (MockManager.isApiKeyRequired() && !apiKey) {
    throw new YouTubeAPIError('YouTube API key is not configured', YOUTUBE_ERROR_CODES.NO_API_KEY)
  }

  const youtube = google.youtube({
    version: YOUTUBE_CONSTANTS.API_VERSION,
    auth: apiKey,
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
    
    // Return mock video details when MOCKS=true for testing
    let videoDetails
    if (MockManager.isYouTubeEnabled()) {
      MockManager.log(`Using mock YouTube video details for search: ${videoIds.join(', ')}`)
      const mockVideoDetails = {
        kind: 'youtube#videoListResponse',
        etag: `mockEtag${videoIds.join(',')}`,
        items: videoIds.map((videoId, index) => createMockVideoData(videoId, {
          title: `Mock Video ${videoId}`,
          artist: MOCK_DATA.CHANNEL_TITLE,
          publishedAt: '2023-01-01T12:00:00Z',
          thumbnailSuffix: `search-${index + 1}`
        }))
      }
      videoDetails = YouTubeVideoDetailsResponseSchema.parse(mockVideoDetails)
    } else {
      const videoDetailsResponse = await youtube.videos.list({
        part: ['snippet', 'contentDetails'],
        id: videoIds,
      })
      videoDetails = YouTubeVideoDetailsResponseSchema.parse(videoDetailsResponse.data)
    }
    
    return videoDetails.items
      .filter((video): video is NonNullable<typeof video> => video != null)
      .map(video => {
        const duration = parseDuration(video.contentDetails.duration)
        return transformVideoData(video, duration)
      })
  } catch (error) {
    console.error('YouTube API error:', error)
    
    if (error instanceof YouTubeAPIError) {
      throw error
    }
    
    if (error instanceof Error) {
      if (error.message.includes('quota')) {
        throw new YouTubeQuotaError()
      }
      if (error.message.includes('key')) {
        throw new YouTubeAuthError()
      }
      if (error.message.includes('network') || error.message.includes('timeout')) {
        throw new YouTubeNetworkError()
      }
    }
    
    throw new YouTubeAPIError('Failed to search YouTube videos. Please try again.', YOUTUBE_ERROR_CODES.SEARCH_FAILED, 500)
  }
}

/**
 * Gets detailed information for a specific YouTube video by ID
 * @param videoId - The YouTube video ID to fetch details for
 * @returns Promise resolving to video details
 * @throws YouTubeAPIError when API key is required but not configured, or when videoId is invalid
 */
export async function getYouTubeVideoDetails(videoId: string): Promise<VideoData> {
  console.log(`getYouTubeVideoDetails called with: ${videoId}`)
  console.log(`MOCKS env var: ${process.env.MOCKS}`)
  console.log(`MockManager.isYouTubeEnabled(): ${MockManager.isYouTubeEnabled()}`)
  
  // Input validation
  if (!videoId || typeof videoId !== 'string' || videoId.trim().length === 0) {
    throw new YouTubeValidationError('Video ID is required and must be a non-empty string', 'videoId')
  }

  const apiKey = MockManager.getApiKey()
  
  if (MockManager.isApiKeyRequired() && !apiKey) {
    throw new YouTubeAPIError('YouTube API key is not configured', YOUTUBE_ERROR_CODES.NO_API_KEY)
  }

  const youtube = google.youtube({
    version: YOUTUBE_CONSTANTS.API_VERSION,
    auth: apiKey,
  })

  // Return mock data when MOCKS=true for testing
  if (MockManager.isYouTubeEnabled()) {
    MockManager.log(`Using mock YouTube video details for: ${videoId}`)
    const mockVideoData = {
      kind: 'youtube#videoListResponse',
      etag: `mockEtag${videoId}`,
      items: [createMockVideoData(videoId, {
        thumbnailSuffix: 'video-details'
      })]
    }
    MockManager.log(`Generated mock data: ${JSON.stringify(mockVideoData, null, 2)}`)
    
    let videoData
    try {
      videoData = YouTubeVideoDetailsResponseSchema.parse(mockVideoData)
      MockManager.log(`Schema validation successful`)
    } catch (parseError) {
      MockManager.log(`Schema validation failed: ${parseError}`)
      MockManager.log(`Mock data: ${JSON.stringify(mockVideoData, null, 2)}`)
      throw parseError
    }
    
    if (videoData.items.length === 0) {
      throw new YouTubeNotFoundError('Video')
    }

    const video = videoData.items[0]
    if (!video) {
      throw new YouTubeNotFoundError('Video')
    }
    
    try {
      const duration = parseDuration(video.contentDetails.duration)
      MockManager.log(`Parsed duration: ${duration}`)
      const result = transformVideoData(video, duration)
      MockManager.log(`Transform successful: ${JSON.stringify(result)}`)
      return result
    } catch (error) {
      MockManager.log(`Transform error: ${error}`)
      throw error
    }
  }

  try {
    const response = await youtube.videos.list({
      part: ['snippet', 'contentDetails'],
      id: [videoId],
    })

    const videoData = YouTubeVideoDetailsResponseSchema.parse(response.data)
    
    if (videoData.items.length === 0) {
      throw new YouTubeNotFoundError('Video')
    }

    const video = videoData.items[0]
    if (!video) {
      throw new YouTubeNotFoundError('Video')
    }
    
    const duration = parseDuration(video.contentDetails.duration)
    return transformVideoData(video, duration)
  } catch (error) {
    console.error('YouTube API error:', error)
    
    if (error instanceof YouTubeAPIError) {
      throw error
    }
    
    if (error instanceof Error) {
      if (error.message.includes('quota')) {
        throw new YouTubeQuotaError()
      }
      if (error.message.includes('key')) {
        throw new YouTubeAuthError()
      }
      if (error.message.includes('network') || error.message.includes('timeout')) {
        throw new YouTubeNetworkError()
      }
    }
    
    throw new YouTubeAPIError('Failed to get YouTube video details. Please try again.', YOUTUBE_ERROR_CODES.FETCH_FAILED, 500)
  }
}
