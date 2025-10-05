import { google } from 'googleapis'
import { z } from 'zod'

// YouTube Data API v3 types
export const YouTubePlaylistSchema = z.object({
  id: z.string(),
  snippet: z.object({
    publishedAt: z.string(),
    channelId: z.string(),
    title: z.string(),
    description: z.string().optional(),
    thumbnails: z.object({
      default: z.object({
        url: z.string(),
        width: z.number(),
        height: z.number(),
      }).optional(),
      medium: z.object({
        url: z.string(),
        width: z.number(),
        height: z.number(),
      }).optional(),
      high: z.object({
        url: z.string(),
        width: z.number(),
        height: z.number(),
      }).optional(),
      maxres: z.object({
        url: z.string(),
        width: z.number(),
        height: z.number(),
      }).optional(),
      standard: z.object({
        url: z.string(),
        width: z.number(),
        height: z.number(),
      }).optional(),
    }),
    channelTitle: z.string(),
    defaultLanguage: z.string().optional(),
    localized: z.object({
      title: z.string(),
      description: z.string(),
    }).optional(),
  }),
  contentDetails: z.object({
    itemCount: z.number(),
  }),
  status: z.object({
    privacyStatus: z.string(),
  }).optional(),
})

export type YouTubePlaylist = z.infer<typeof YouTubePlaylistSchema>

export const YouTubePlaylistListResponseSchema = z.object({
  kind: z.string(),
  etag: z.string(),
  nextPageToken: z.string().optional(),
  prevPageToken: z.string().optional(),
  pageInfo: z.object({
    totalResults: z.number(),
    resultsPerPage: z.number(),
  }),
  items: z.array(YouTubePlaylistSchema),
})

export type YouTubePlaylistListResponse = z.infer<typeof YouTubePlaylistListResponseSchema>

export class YouTubeService {
  private youtube: any

  constructor(apiKey?: string) {
    if (!apiKey) {
      throw new Error('YouTube API key is required')
    }
    
    this.youtube = google.youtube({
      version: 'v3',
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
      version: 'v3',
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
    const oauth2Client = new google.auth.OAuth2()
    oauth2Client.setCredentials({ access_token: accessToken })

    const youtube = google.youtube({
      version: 'v3',
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
      return validatedResponse
    } catch (error) {
      console.error('Error fetching YouTube playlists:', error)
      throw new Error('Failed to fetch YouTube playlists')
    }
  }

  /**
   * Get a specific playlist by ID
   */
  async getPlaylist(playlistId: string, accessToken?: string): Promise<YouTubePlaylist> {
    let auth: any = undefined
    if (accessToken) {
      auth = new google.auth.OAuth2()
      auth.setCredentials({ access_token: accessToken })
    }

    const youtube = google.youtube({
      version: 'v3',
      auth: auth || (process.env.YOUTUBE_API_KEY ? process.env.YOUTUBE_API_KEY : undefined),
    })

    try {
      const response = await youtube.playlists.list({
        part: ['snippet', 'contentDetails'],
        id: [playlistId],
      })

      if (!response.data.items || response.data.items.length === 0) {
        throw new Error('Playlist not found')
      }

      const validatedPlaylist = YouTubePlaylistSchema.parse(response.data.items[0])
      return validatedPlaylist
    } catch (error) {
      console.error('Error fetching YouTube playlist:', error)
      throw new Error('Failed to fetch YouTube playlist')
    }
  }

  /**
   * Get playlist items (videos) for a specific playlist
   */
  async getPlaylistItems(playlistId: string, accessToken?: string, maxResults = 50): Promise<any[]> {
    let auth: any = undefined
    if (accessToken) {
      auth = new google.auth.OAuth2()
      auth.setCredentials({ access_token: accessToken })
    }

    const youtube = google.youtube({
      version: 'v3',
      auth: auth || (process.env.YOUTUBE_API_KEY ? process.env.YOUTUBE_API_KEY : undefined),
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
      throw new Error('Failed to fetch playlist items')
    }
  }
}

/**
 * Create a YouTube service instance
 */
export function createYouTubeService(): YouTubeService {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) {
    throw new Error('YOUTUBE_API_KEY environment variable is required')
  }
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
