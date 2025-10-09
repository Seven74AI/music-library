import { google } from 'googleapis'
import { 
  YOUTUBE_RATE_LIMITS,
  YOUTUBE_API_VERSION
} from '#app/config/youtube'
import { transformYouTubeVideoToVideoData } from '#app/types/transformations'
import { 
  YouTubeSearchResponseSchema, 
  YouTubeVideoListResponseSchema
} from '#app/types/youtube-api'
import { validateYouTubeAPIResponse } from '#app/utils/validation'
import { 
  YouTubeAPIError, 
  YouTubeValidationError, 
  YouTubeNetworkError, 
  YouTubeQuotaError, 
  YouTubeAuthError, 
  YouTubeNotFoundError,
  YOUTUBE_ERROR_CODES 
} from '#app/utils/youtube-errors'
import { shouldMockYouTube } from '#app/utils/youtube-mock-utils'
import { 
  type VideoData 
} from '#app/utils/youtube-utils'

/**
 * Searches for YouTube videos based on a query string
 * @param query - The search query string
 * @param maxResults - Maximum number of results to return (default: 10)
 * @returns Promise resolving to array of video data
 * @throws YouTubeAPIError when API key is required but not configured, or when parameters are invalid
 */
export async function searchYouTubeVideos(query: string, maxResults = YOUTUBE_RATE_LIMITS.DEFAULT_SEARCH_RESULTS): Promise<VideoData[]> {
  // Input validation
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    throw new YouTubeValidationError('Query parameter is required and must be a non-empty string', 'query')
  }
  
  if (maxResults < YOUTUBE_RATE_LIMITS.MIN_SEARCH_RESULTS || maxResults > YOUTUBE_RATE_LIMITS.MAX_SEARCH_RESULTS) {
    throw new YouTubeValidationError(
      `maxResults must be between ${YOUTUBE_RATE_LIMITS.MIN_SEARCH_RESULTS} and ${YOUTUBE_RATE_LIMITS.MAX_SEARCH_RESULTS}`,
      'maxResults'
    )
  }

  // Return mock data when mocking is enabled
  if (shouldMockYouTube()) {
    return getMockSearchResults(query, maxResults)
  }

  const apiKey = process.env.YOUTUBE_API_KEY
  
  if (!apiKey) {
    throw new YouTubeAPIError('YouTube API key is not configured', YOUTUBE_ERROR_CODES.NO_API_KEY)
  }

  const youtube = google.youtube({
    version: YOUTUBE_API_VERSION,
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

    // Validate API response with new type-safe architecture
    const searchData = validateYouTubeAPIResponse(
      response.data,
      YouTubeSearchResponseSchema
    )
    
    if (!searchData.items || searchData.items.length === 0) {
      return []
    }
    
    // Get detailed video information including duration
    const videoIds = searchData.items.map(item => item.id?.videoId).filter(Boolean) as string[]
    
    if (videoIds.length === 0) {
      return []
    }
    
    // Get video details from YouTube API
    const videoDetailsResponse = await youtube.videos.list({
      part: ['snippet', 'contentDetails'],
      id: videoIds,
    })
    
    // Validate API response with new type-safe architecture
    const videoDetails = validateYouTubeAPIResponse(
      videoDetailsResponse.data,
      YouTubeVideoListResponseSchema
    )
    
    return videoDetails.items
      ?.filter((video): video is NonNullable<typeof video> => video != null)
      .map(video => transformYouTubeVideoToVideoData(video)) || []
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
  // Input validation
  if (!videoId || typeof videoId !== 'string' || videoId.trim().length === 0) {
    throw new YouTubeValidationError('Video ID is required and must be a non-empty string', 'videoId')
  }

  // Return mock data when mocking is enabled
  if (shouldMockYouTube()) {
    return getMockVideoDetails(videoId)
  }

  const apiKey = process.env.YOUTUBE_API_KEY
  
  if (!apiKey) {
    throw new YouTubeAPIError('YouTube API key is not configured', YOUTUBE_ERROR_CODES.NO_API_KEY)
  }

  const youtube = google.youtube({
    version: YOUTUBE_API_VERSION,
    auth: apiKey,
  })


  try {
    const response = await youtube.videos.list({
      part: ['snippet', 'contentDetails'],
      id: [videoId],
    })

    // Validate API response with new type-safe architecture
    const videoData = validateYouTubeAPIResponse(
      response.data,
      YouTubeVideoListResponseSchema
    )
    
    if (!videoData.items || videoData.items.length === 0) {
      throw new YouTubeNotFoundError('Video')
    }

    const video = videoData.items[0]
    if (!video) {
      throw new YouTubeNotFoundError('Video')
    }
    
    return transformYouTubeVideoToVideoData(video)
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

// Mock data functions using mock generators
function getMockSearchResults(query: string, maxResults: number): VideoData[] {
  const results: VideoData[] = []
  for (let i = 1; i <= Math.min(maxResults, 5); i++) {
    results.push({
      id: `mock-video-${i}`,
      title: `Mock Video ${i} - ${query}`,
      artist: 'Mock Artist',
      duration: 180 + (i * 30), // 3-7 minutes
      thumbnailUrl: `https://i.ytimg.com/vi/mock${i}/mqdefault.jpg`,
      serviceUrl: `https://youtube.com/watch?v=mock-video-${i}`,
      publishedAt: `2023-01-0${i}T00:00:00Z`
    })
  }
  return results
}

function getMockVideoDetails(videoId: string): VideoData {
  // Return realistic mock data that matches test expectations
  return {
    id: videoId,
    title: 'Never Gonna Give You Up',
    artist: 'Rick Astley',
    duration: 240, // 4 minutes
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    serviceUrl: `https://youtube.com/watch?v=${videoId}`,
    publishedAt: '2009-10-25T06:57:33Z'
  }
}

