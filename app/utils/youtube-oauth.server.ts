import { google } from 'googleapis'
import { z } from 'zod'
import { shouldMockYouTube } from './youtube-mock-utils'

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

/**
 * Service class for handling YouTube OAuth authentication
 * Manages OAuth flow, token exchange, and user authorization
 */
export class YouTubeOAuthService {
  private oauth2Client: any
  private config: YouTubeOAuthConfig

  /**
   * Creates a new YouTubeOAuthService instance
   * 
   * @param config - OAuth configuration object
   */
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
   * 
   * @param state - Optional state parameter for OAuth flow
   * @returns The authorization URL
   */
  getAuthUrl(state?: string): string {
    // If YouTube mocking is enabled, return a mock callback URL
    if (shouldMockYouTube()) {
      const mockCallbackUrl = new URL(this.config.redirectUri)
      mockCallbackUrl.searchParams.set('code', 'mock-auth-code')
      mockCallbackUrl.searchParams.set('state', state || 'mock-state')
      return mockCallbackUrl.toString()
    }
    
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: YOUTUBE_SCOPES,
      state,
      prompt: 'consent', // Force consent to get refresh token
    })
  }

  /**
   * Exchange authorization code for tokens
   * 
   * @param code - The authorization code from OAuth callback
   * @returns Promise resolving to token data
   */
  async getTokens(code: string): Promise<{
    access_token: string
    refresh_token?: string
    expiry_date?: number
  }> {
    // If YouTube mocking is enabled, return mock tokens
    if (shouldMockYouTube()) {
      return {
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expiry_date: Date.now() + 3600000, // 1 hour from now
      }
    }
    
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
    // If YouTube mocking is enabled, return mock refreshed tokens
    if (shouldMockYouTube()) {
      return {
        access_token: 'mock-refreshed-access-token',
        expiry_date: Date.now() + 3600000, // 1 hour from now
      }
    }
    
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
 * Factory function to create a YouTubeOAuthService instance
 * Validates required environment variables
 * 
 * @returns YouTubeOAuthService instance
 * @throws Error if required environment variables are missing
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
    redirectUri: `${process.env.SITE_URL || 'http://localhost:3000'}/music/services/youtube/callback`,
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
