import { google } from 'googleapis'
import { 
  YOUTUBE_CONSTANTS, 
  MOCK_DATA, 
  MockManager,
  createMockPlaylistItem,
  createMockPlaylistData
} from '#app/config/youtube'
import { 
  YouTubePlaylistSchema, 
  YouTubePlaylistListResponseSchema,
  type YouTubePlaylist,
  type YouTubePlaylistListResponse
} from '#app/types/youtube'
import { 
  YouTubeAPIError, 
  YouTubeNotFoundError,
  YOUTUBE_ERROR_CODES 
} from '#app/utils/youtube-errors'

export class YouTubeService {
  private youtube: any
  public readonly name = 'youtube'

  constructor(apiKey?: string) {
    // API key is optional - some operations use OAuth instead
    this.youtube = google.youtube({
      version: YOUTUBE_CONSTANTS.API_VERSION,
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
      version: YOUTUBE_CONSTANTS.API_VERSION,
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
    // Return mock data when MOCKS=true for testing
    if (MockManager.isEnabled()) {
      MockManager.log('Using mock YouTube playlists data')
      return {
        kind: 'youtube#playlistListResponse',
        etag: 'mockEtag123',
        pageInfo: {
          totalResults: 2,
          resultsPerPage: 25
        },
        items: [
          createMockPlaylistData('PLtest123', {
            title: MOCK_DATA.PLAYLIST_TITLE,
            description: MOCK_DATA.PLAYLIST_DESCRIPTION,
            channelTitle: 'Test Channel',
            channelId: 'UCtest123',
            itemCount: 5,
            thumbnailSuffix: '1'
          }),
          createMockPlaylistData('PLtest456', {
            title: 'Another Test Playlist',
            description: 'Another test playlist',
            channelTitle: 'Another Channel',
            channelId: 'UCtest456',
            itemCount: 10,
            thumbnailSuffix: '2'
          })
        ]
      }
    }

    const oauth2Client = new google.auth.OAuth2()
    oauth2Client.setCredentials({ access_token: accessToken })

    const youtube = google.youtube({
      version: YOUTUBE_CONSTANTS.API_VERSION,
      auth: oauth2Client,
    })

    try {
      const response = await youtube.playlists.list({
        part: ['snippet', 'contentDetails'],
        mine: true,
        maxResults,
        pageToken,
      })

      const validatedResponse = YouTubePlaylistListResponseSchema.parse(response.data)
      return validatedResponse as YouTubePlaylistListResponse
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
    // Return mock data when MOCKS=true for testing
    if (MockManager.isEnabled()) {
      MockManager.log(`Using mock YouTube playlist data for: ${playlistId}`)
      return createMockPlaylistData(playlistId, {
        title: playlistId === 'PLtest123' ? MOCK_DATA.PLAYLIST_TITLE : 'Another Test Playlist',
        description: playlistId === 'PLtest123' ? MOCK_DATA.PLAYLIST_DESCRIPTION : 'Another test playlist',
        channelTitle: 'Test Channel',
        channelId: 'UCtest123',
        itemCount: playlistId === 'PLtest123' ? 5 : 10,
        thumbnailSuffix: '1'
      })
    }

    const oauth2Client = new google.auth.OAuth2()
    oauth2Client.setCredentials({ access_token: accessToken })

    const youtube = google.youtube({
      version: YOUTUBE_CONSTANTS.API_VERSION,
      auth: oauth2Client,
    })

    try {
      const response = await youtube.playlists.list({
        part: ['snippet', 'contentDetails'],
        id: [playlistId],
      })

      if (!response.data.items || response.data.items.length === 0) {
        throw new YouTubeNotFoundError('Playlist')
      }

      const validatedPlaylist = YouTubePlaylistSchema.parse(response.data.items[0])
      return validatedPlaylist as YouTubePlaylist
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
  async getPlaylistItems(playlistId: string, accessToken: string, maxResults = 50): Promise<any[]> {
    // Return mock data when MOCKS=true for testing
    if (MockManager.isEnabled()) {
      MockManager.log(`Using mock YouTube playlist items data for: ${playlistId}`)
      const itemCount = playlistId === 'PLtest123' ? 5 : 10
      return Array.from({ length: itemCount }, (_, index) => 
        createMockPlaylistItem(playlistId, index)
      )
    }

    const oauth2Client = new google.auth.OAuth2()
    oauth2Client.setCredentials({ access_token: accessToken })

    const youtube = google.youtube({
      version: YOUTUBE_CONSTANTS.API_VERSION,
      auth: oauth2Client,
    })

    try {
      const response = await youtube.playlistItems.list({
        part: ['snippet', 'contentDetails'],
        playlistId,
        maxResults,
      })

      return response.data.items || []
    } catch (error) {
      console.error('Error fetching playlist items:', error)
      throw new YouTubeAPIError('Failed to fetch playlist items', YOUTUBE_ERROR_CODES.API_ERROR, 500)
    }
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

/**
 * Transform YouTube playlist data to our database format
 */
export function transformYouTubePlaylist(playlist: YouTubePlaylist, userId: string) {
  return {
    youtubeId: playlist.id,
    title: playlist.snippet.title,
    description: playlist.snippet.description || null,
    thumbnailUrl: playlist.snippet.thumbnails.maxres?.url || 
                  playlist.snippet.thumbnails.standard?.url || 
                  playlist.snippet.thumbnails.high?.url || 
                  playlist.snippet.thumbnails.medium?.url || 
                  playlist.snippet.thumbnails.default?.url || 
                  null,
    channelId: playlist.snippet.channelId,
    channelTitle: playlist.snippet.channelTitle,
    publishedAt: new Date(playlist.snippet.publishedAt),
    itemCount: playlist.contentDetails.itemCount,
    ownerId: userId,
  }
}
