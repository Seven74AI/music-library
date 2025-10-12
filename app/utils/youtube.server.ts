import { google } from 'googleapis'
import { 
  YOUTUBE_API_VERSION
} from '#app/config/youtube'
import { 
  YouTubePlaylistListResponseSchema,
  YouTubePlaylistItemListResponseSchema,
  type YouTubePlaylistItem,
  type YouTubePlaylist,
  type YouTubePlaylistListResponse
} from '#app/types/youtube-api'
import { 
  createFakerYouTubePlaylist, 
  createFakerYouTubePlaylistItem 
} from '#app/utils/mock-generators'
import { validateYouTubeAPIResponse } from '#app/utils/validation'
import { 
  YouTubeAPIError, 
  YouTubeNotFoundError,
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
   */
  async getUserPlaylists(accessToken: string, maxResults = 25, pageToken?: string): Promise<YouTubePlaylistListResponse> {
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
      const response = await youtube.playlists.list({
        part: ['snippet', 'contentDetails'],
        mine: true,
        maxResults,
        pageToken,
      })

      // Validate API response with new type-safe architecture
      return validateYouTubeAPIResponse(
        response.data,
        YouTubePlaylistListResponseSchema
      )
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
      const response = await youtube.playlistItems.list({
        part: ['snippet', 'contentDetails'],
        playlistId,
        maxResults,
      })

      // Validate API response with new type-safe architecture
      const validatedResponse = validateYouTubeAPIResponse(
        response.data,
        YouTubePlaylistItemListResponseSchema
      )

      return validatedResponse.items || []
    } catch (error) {
      console.error('Error fetching playlist items:', error)
      throw new YouTubeAPIError('Failed to fetch playlist items', YOUTUBE_ERROR_CODES.API_ERROR, 500)
    }
  }

  // Mock data methods using mock generators
  private getMockUserPlaylists(): YouTubePlaylistListResponse {
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

    return {
      kind: 'youtube#playlistListResponse',
      etag: 'mock-etag',
      items: playlists
    }
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

