import { google } from 'googleapis'
import { 
  YOUTUBE_API_VERSION
} from '#app/config/youtube'
import { 
  YouTubePlaylistListResponseSchema,
  YouTubePlaylistItemListResponseSchema,
  type YouTubePlaylistItem,
  type YouTubePlaylist,
  type YouTubePlaylistListResponse,
  type YouTubePlaylistItemListResponse
} from '#app/types/youtube-api'
import { 
  createFakerYouTubePlaylist, 
  createFakerYouTubePlaylistItem 
} from '#app/utils/mock-generators'
import { validateYouTubeAPIResponse } from '#app/utils/validation'
import { 
  YouTubeAPIError, 
  YouTubeNotFoundError,
  YouTubeQuotaError,
  YouTubeAuthError,
  YouTubeNetworkError,
  YOUTUBE_ERROR_CODES 
} from '#app/utils/youtube-errors'
import { shouldMockYouTube } from '#app/utils/youtube-mock-utils'

export class YouTubeService {
  private youtube: any
  public readonly name = 'youtube'

  constructor(apiKey?: string) {
    // API key is optional - some operations use OAuth instead
    this.youtube = google.youtube({
      version: YOUTUBE_API_VERSION,
      auth: apiKey,
    })
  }

  /**
   * Get YouTube user info
   */
  async getYouTubeUserInfo(accessToken: string): Promise<{ id: string; email: string; name: string }> {
    const oauth2Client = new google.auth.OAuth2()
    oauth2Client.setCredentials({ access_token: accessToken })

    const youtube = google.youtube({
      version: YOUTUBE_API_VERSION,
      auth: oauth2Client,
    })

    try {
      const response = await youtube.channels.list({
        part: ['snippet'],
        mine: true,
      })

      if (!response.data.items || response.data.items.length === 0) {
        throw new Error('No YouTube channel found. Please make sure you have a YouTube channel.')
      }

      const channel = response.data.items[0]
      if (!channel?.id) {
        throw new Error('No valid YouTube channel ID found')
      }
      
      return {
        id: channel.id,
        email: '', // YouTube API doesn't provide email in channels.list
        name: channel.snippet?.title || 'Unknown',
      }
    } catch (error) {
      console.error('Error fetching YouTube user info:', error)
      if (error instanceof Error) {
        throw new Error(`Failed to fetch YouTube user information: ${error.message}`)
      }
      throw new Error('Failed to fetch YouTube user information')
    }
  }

  /**
   * Get user's YouTube playlists
   * Fetches all playlists using cursor pagination (similar to getPlaylistItems)
   * 
   * @param accessToken - OAuth access token
   * @param maxResults - Maximum results per page (default: 50, max: 50)
   * @returns Promise resolving to all playlists across all pages
   */
  async getUserPlaylists(accessToken: string, maxResults = 50): Promise<YouTubePlaylist[]> {
    // Return mock data when mocking is enabled
    if (shouldMockYouTube()) {
      return this.getMockUserPlaylists()
    }

    const oauth2Client = new google.auth.OAuth2()
    oauth2Client.setCredentials({ access_token: accessToken })

    const youtube = google.youtube({
      version: YOUTUBE_API_VERSION,
      auth: oauth2Client,
    })

    try {
      const allPlaylists: YouTubePlaylist[] = []
      let nextPageToken: string | undefined = undefined

      // Loop through all pages until no more nextPageToken
      do {
        const response = await youtube.playlists.list({
          part: ['snippet', 'contentDetails'],
          mine: true,
          maxResults: Math.min(maxResults, 50), // YouTube API max is 50
          pageToken: nextPageToken,
        })

        // Validate API response with new type-safe architecture
        const validatedResponse = validateYouTubeAPIResponse(
          response.data,
          YouTubePlaylistListResponseSchema
        ) as YouTubePlaylistListResponse

        // Add playlists from this page to the accumulated array
        if (validatedResponse.items) {
          allPlaylists.push(...validatedResponse.items)
        }

        // Get nextPageToken for next iteration
        nextPageToken = validatedResponse.nextPageToken
      } while (nextPageToken)

      return allPlaylists
    } catch (error) {
      console.error('Error fetching YouTube playlists:', error)
      throw new YouTubeAPIError('Failed to fetch YouTube playlists', YOUTUBE_ERROR_CODES.API_ERROR, 500)
    }
  }

  /**
   * Get a specific playlist by ID
   * Requires accessToken for user's own playlists
   */
  async getPlaylist(playlistId: string, accessToken: string): Promise<YouTubePlaylist> {
    // Return mock data when mocking is enabled
    if (shouldMockYouTube()) {
      const mockResponse = this.getMockPlaylist(playlistId)
      const playlist = mockResponse.items?.[0]
      if (!playlist) {
        throw new YouTubeNotFoundError('Playlist')
      }
      return playlist
    }

    const oauth2Client = new google.auth.OAuth2()
    oauth2Client.setCredentials({ access_token: accessToken })

    const youtube = google.youtube({
      version: YOUTUBE_API_VERSION,
      auth: oauth2Client,
    })

    try {
      const response = await youtube.playlists.list({
        part: ['snippet', 'contentDetails'],
        id: [playlistId],
      })

      // Validate API response with new type-safe architecture
      const validatedResponse = validateYouTubeAPIResponse(
        response.data,
        YouTubePlaylistListResponseSchema
      )
      
      if (!validatedResponse.items || validatedResponse.items.length === 0) {
        throw new YouTubeNotFoundError('Playlist')
      }

      const playlist = validatedResponse.items[0]
      if (!playlist) {
        throw new YouTubeNotFoundError('Playlist')
      }
      return playlist
    } catch (error) {
      console.error('Error fetching YouTube playlist:', error)
      if (error instanceof YouTubeNotFoundError) {
        throw error
      }
      throw new YouTubeAPIError('Failed to fetch YouTube playlist', YOUTUBE_ERROR_CODES.API_ERROR, 500)
    }
  }

  /**
   * Get playlist items (videos) for a specific playlist
   * Requires accessToken for user's own playlists
   * Handles pagination to fetch all items across multiple pages
   */
  async getPlaylistItems(playlistId: string, accessToken: string, maxResults = 50): Promise<YouTubePlaylistItem[]> {
    // Return mock data when mocking is enabled
    if (shouldMockYouTube()) {
      const mockResponse = this.getMockPlaylistItems(playlistId, maxResults)
      return mockResponse.items || []
    }

    const oauth2Client = new google.auth.OAuth2()
    oauth2Client.setCredentials({ access_token: accessToken })

    const youtube = google.youtube({
      version: YOUTUBE_API_VERSION,
      auth: oauth2Client,
    })

    try {
      const allItems: YouTubePlaylistItem[] = []
      let nextPageToken: string | undefined = undefined

      // Loop through all pages until no more nextPageToken
      do {
        const response = await youtube.playlistItems.list({
          part: ['snippet', 'contentDetails'],
          playlistId,
          maxResults,
          pageToken: nextPageToken,
        })

        // Validate API response with new type-safe architecture
        const validatedResponse = validateYouTubeAPIResponse(
          response.data,
          YouTubePlaylistItemListResponseSchema
        ) as YouTubePlaylistItemListResponse

        // Add items from this page to the accumulated array
        if (validatedResponse.items) {
          allItems.push(...validatedResponse.items)
        }

        // Get nextPageToken for next iteration
        nextPageToken = validatedResponse.nextPageToken
      } while (nextPageToken)

      return allItems
    } catch (error) {
      console.error('Error fetching playlist items:', error)
      
      // Extract more specific error information from YouTube API
      if (error && typeof error === 'object' && 'response' in error) {
        const apiError = error as { response?: { data?: { error?: { code?: number; message?: string; errors?: Array<{ message?: string; reason?: string }> } } } }
        const errorData = apiError.response?.data?.error
        
        if (errorData) {
          const errorCode = errorData.code
          const errorMessage = errorData.message || 'Unknown error'
          const firstError = errorData.errors?.[0]
          
          // Handle specific error codes
          if (errorCode === 404) {
            throw new YouTubeNotFoundError('Playlist')
          }
          
          if (errorCode === 403) {
            // Check for quota exceeded
            if (errorMessage.includes('quota') || errorMessage.includes('Quota')) {
              throw new YouTubeQuotaError()
            }
            // Check for access denied
            if (errorMessage.includes('access') || errorMessage.includes('permission') || firstError?.reason === 'forbidden') {
              throw new YouTubeAPIError('Access denied. The playlist may be private or you may not have permission to view it.', 'ACCESS_DENIED', 403)
            }
            throw new YouTubeAPIError('Access denied. Please check your YouTube account permissions.', 'ACCESS_DENIED', 403)
          }
          
          if (errorCode === 401) {
            throw new YouTubeAuthError('Invalid or expired access token. Please reconnect your YouTube account.')
          }
          
          // Use the API's error message if available
          throw new YouTubeAPIError(errorMessage, YOUTUBE_ERROR_CODES.API_ERROR, errorCode || 500)
        }
      }
      
      // Handle other error types
      if (error instanceof YouTubeAPIError || error instanceof YouTubeNotFoundError || error instanceof YouTubeQuotaError || error instanceof YouTubeAuthError) {
        throw error
      }
      
      if (error instanceof Error) {
        if (error.message.includes('quota')) {
          throw new YouTubeQuotaError()
        }
        if (error.message.includes('network') || error.message.includes('timeout') || error.message.includes('ECONNREFUSED')) {
          throw new YouTubeNetworkError('Unable to connect to YouTube. Please check your internet connection and try again.')
        }
        if (error.message.includes('not found') || error.message.includes('404')) {
          throw new YouTubeNotFoundError('Playlist')
        }
      }
      
      throw new YouTubeAPIError('Failed to fetch playlist items. Please try again.', YOUTUBE_ERROR_CODES.API_ERROR, 500)
    }
  }

  // Mock data methods using mock generators
  private getMockUserPlaylists(): YouTubePlaylist[] {
    // Generate 2 playlists using mock generators
    const playlists = [
      createFakerYouTubePlaylist('PLtest1', {
        title: 'Test Playlist 1',
        description: 'A test playlist',
        itemCount: 5,
        channelTitle: 'Test Channel'
      }),
      createFakerYouTubePlaylist('PLtest2', {
        title: 'Test Playlist 2', 
        description: 'Another test playlist',
        itemCount: 3,
        channelTitle: 'Another Channel'
      })
    ]

    return playlists
  }

  private getMockPlaylist(playlistId: string): { items: YouTubePlaylist[] } {
    const playlist = createFakerYouTubePlaylist(playlistId, {
      title: 'Test Playlist',
      description: 'A test playlist',
      itemCount: 5,
      channelTitle: 'Test Channel'
    })

    return {
      items: [playlist]
    }
  }

  private getMockPlaylistItems(playlistId: string, maxResults: number): { items: YouTubePlaylistItem[] } {
    const items: YouTubePlaylistItem[] = []
    for (let i = 0; i < Math.min(maxResults, 5); i++) {
      items.push(createFakerYouTubePlaylistItem(playlistId, i, {
        title: `Test Video ${i + 1}`,
        artist: 'Test Artist',
        videoId: `test-video-${i + 1}`
      }))
    }
    return { items }
  }

}

/**
 * Create a YouTube service instance
 * API key is optional - OAuth operations don't need it
 */
export function createYouTubeService(): YouTubeService {
  const apiKey = process.env.YOUTUBE_API_KEY
  return new YouTubeService(apiKey)
}

