import { google } from 'googleapis'
import { z } from 'zod'

// YouTube OAuth scopes
export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube',
]

// OAuth configuration schema
export const YouTubeOAuthConfigSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string(),
  redirectUri: z.string(),
})

export type YouTubeOAuthConfig = z.infer<typeof YouTubeOAuthConfigSchema>

export class YouTubeOAuthService {
  private oauth2Client: any
  private config: YouTubeOAuthConfig

  constructor(config: YouTubeOAuthConfig) {
    this.config = config
    this.oauth2Client = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret,
      config.redirectUri
    )
  }

  /**
   * Generate the authorization URL for YouTube OAuth
   */
  getAuthUrl(state?: string): string {
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: YOUTUBE_SCOPES,
      state,
      prompt: 'consent', // Force consent to get refresh token
    })
  }

  /**
   * Exchange authorization code for tokens
   */
  async getTokens(code: string): Promise<{
    access_token: string
    refresh_token?: string
    expiry_date?: number
  }> {
    try {
      const { tokens } = await this.oauth2Client.getToken(code)
      return tokens
    } catch (error) {
      console.error('Error exchanging code for tokens:', error)
      throw new Error('Failed to exchange authorization code for tokens')
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<{
    access_token: string
    expiry_date?: number
  }> {
    try {
      this.oauth2Client.setCredentials({
        refresh_token: refreshToken,
      })

      const { credentials } = await this.oauth2Client.refreshAccessToken()
      return credentials
    } catch (error) {
      console.error('Error refreshing access token:', error)
      throw new Error('Failed to refresh access token')
    }
  }

  /**
   * Set credentials for API calls
   */
  setCredentials(tokens: {
    access_token?: string
    refresh_token?: string
    expiry_date?: number
  }) {
    this.oauth2Client.setCredentials(tokens)
  }

  /**
   * Get the OAuth2 client instance
   */
  getOAuth2Client() {
    return this.oauth2Client
  }
}

/**
 * Create YouTube OAuth service instance
 */
export function createYouTubeOAuthService(): YouTubeOAuthService {
  if (!process.env.GOOGLE_CLIENT_ID) {
    throw new Error('GOOGLE_CLIENT_ID environment variable is required')
  }
  if (!process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error('GOOGLE_CLIENT_SECRET environment variable is required')
  }

  const config = YouTubeOAuthConfigSchema.parse({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: `${process.env.SITE_URL || 'http://localhost:3000'}/youtube/callback`,
  })

  return new YouTubeOAuthService(config)
}

/**
 * Validate YouTube tokens
 */
export async function validateYouTubeTokens(tokens: {
  access_token?: string
  refresh_token?: string
  expiry_date?: number
}): Promise<boolean> {
  try {
    const oauth2Client = new google.auth.OAuth2()
    oauth2Client.setCredentials(tokens)

    const youtube = google.youtube({
      version: 'v3',
      auth: oauth2Client,
    })

    // Test the token by making a simple API call
    await youtube.channels.list({
      part: ['id'],
      mine: true,
    })

    return true
  } catch (error) {
    console.error('YouTube token validation failed:', error)
    return false
  }
}
