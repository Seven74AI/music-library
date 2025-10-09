import { z } from 'zod'

/**
 * YouTube OAuth Types
 * 
 * This file contains OAuth-related types for YouTube integration.
 * These types are actively used for OAuth token handling and validation.
 * 
 * API response types are in app/types/youtube-api.ts for separation of concerns.
 * 
 * @see {@link ./youtube-api.ts} for YouTube API types and schemas
 */

// Zod schema for YouTube OAuth tokens (matches official Google OAuth response)
export const YouTubeTokenDataSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expiry_date: z.number().optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
  youtubeUserId: z.string().optional(),
})

// YouTube OAuth token types (inferred from Zod schema)
export type YouTubeTokenData = z.infer<typeof YouTubeTokenDataSchema>

export interface ValidatedOAuthConnection {
  tokenData: YouTubeTokenData
  connection: {
    id: string
    providerName: string
    providerId: string
    userId: string
    tokens: string | null
    createdAt: Date
    updatedAt: Date
  }
}
