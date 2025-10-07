/**
 * Centralized YouTube types and schemas
 * Single source of truth for all YouTube-related TypeScript types
 */

import { z } from 'zod'

// Common thumbnail types
export interface YouTubeThumbnail {
  url: string
  width: number
  height: number
}

export interface YouTubeThumbnails {
  default?: YouTubeThumbnail
  medium?: YouTubeThumbnail
  high?: YouTubeThumbnail
  standard?: YouTubeThumbnail
  maxres?: YouTubeThumbnail
}

// YouTube API response types
export interface YouTubePlaylistSnippet {
  publishedAt: string
  channelId: string
  title: string
  description?: string
  thumbnails: YouTubeThumbnails
  channelTitle: string
  defaultLanguage?: string
  localized?: {
    title: string
    description: string
  }
}

export interface YouTubePlaylistContentDetails {
  itemCount: number
}

export interface YouTubePlaylistStatus {
  privacyStatus: string
}

export interface YouTubePlaylist {
  kind: string
  etag: string
  id: string
  snippet: YouTubePlaylistSnippet
  contentDetails: YouTubePlaylistContentDetails
  status?: YouTubePlaylistStatus
  subscriberSnippet?: {
    title: string
    description: string
  }
  // Added by our service
  isSynced?: boolean
}

export interface YouTubePlaylistListResponse {
  kind: string
  etag: string
  nextPageToken?: string
  prevPageToken?: string
  pageInfo: {
    totalResults: number
    resultsPerPage: number
  }
  items: YouTubePlaylist[]
}

// Search result types
export interface YouTubeSearchResult {
  id: {
    kind: string
    videoId: string
  }
  snippet: {
    title: string
    channelTitle: string
    publishedAt: string
    thumbnails: YouTubeThumbnails
  }
}

export interface YouTubeSearchResponse {
  items: YouTubeSearchResult[]
  nextPageToken?: string
  pageInfo: {
    totalResults: number
    resultsPerPage: number
  }
}

// Video details types
export interface YouTubeVideoDetails {
  id: string
  snippet: {
    title: string
    channelTitle: string
    publishedAt: string
    thumbnails: YouTubeThumbnails
  }
  contentDetails: {
    duration: string // ISO 8601 duration format
  }
}

export interface YouTubeVideoDetailsResponse {
  items: YouTubeVideoDetails[]
}

// Zod schemas for validation
export const YouTubeThumbnailSchema = z.object({
  url: z.string(),
  width: z.number(),
  height: z.number(),
})

export const YouTubeThumbnailsSchema = z.object({
  default: YouTubeThumbnailSchema.optional(),
  medium: YouTubeThumbnailSchema.optional(),
  high: YouTubeThumbnailSchema.optional(),
  standard: YouTubeThumbnailSchema.optional(),
  maxres: YouTubeThumbnailSchema.optional(),
})

export const YouTubePlaylistSnippetSchema = z.object({
  publishedAt: z.string(),
  channelId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  thumbnails: YouTubeThumbnailsSchema,
  channelTitle: z.string(),
  defaultLanguage: z.string().optional(),
  localized: z.object({
    title: z.string(),
    description: z.string(),
  }).optional(),
})

export const YouTubePlaylistContentDetailsSchema = z.object({
  itemCount: z.number(),
})

export const YouTubePlaylistStatusSchema = z.object({
  privacyStatus: z.string(),
})

export const YouTubePlaylistSchema = z.object({
  kind: z.string().optional(),
  etag: z.string().optional(),
  id: z.string(),
  snippet: YouTubePlaylistSnippetSchema,
  contentDetails: YouTubePlaylistContentDetailsSchema,
  status: YouTubePlaylistStatusSchema.optional(),
})

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

export const YouTubeSearchResultSchema = z.object({
  id: z.object({
    kind: z.string(),
    videoId: z.string(),
  }),
  snippet: z.object({
    title: z.string(),
    channelTitle: z.string(),
    publishedAt: z.string(),
    thumbnails: YouTubeThumbnailsSchema,
  }),
})

export const YouTubeSearchResponseSchema = z.object({
  items: z.array(YouTubeSearchResultSchema),
  nextPageToken: z.string().optional(),
  pageInfo: z.object({
    totalResults: z.number(),
    resultsPerPage: z.number(),
  }),
})

export const YouTubeVideoDetailsSchema = z.object({
  id: z.string(),
  snippet: z.object({
    title: z.string(),
    channelTitle: z.string(),
    publishedAt: z.string(),
    thumbnails: YouTubeThumbnailsSchema,
  }),
  contentDetails: z.object({
    duration: z.string(), // ISO 8601 duration format
  }),
})

export const YouTubeVideoDetailsResponseSchema = z.object({
  kind: z.string(),
  etag: z.string(),
  items: z.array(YouTubeVideoDetailsSchema),
})

// Type exports from schemas (using type aliases to avoid conflicts)
export type YouTubePlaylistType = z.infer<typeof YouTubePlaylistSchema>
export type YouTubePlaylistListResponseType = z.infer<typeof YouTubePlaylistListResponseSchema>
export type YouTubeSearchResultType = z.infer<typeof YouTubeSearchResultSchema>
export type YouTubeSearchResponseType = z.infer<typeof YouTubeSearchResponseSchema>
export type YouTubeVideoDetailsType = z.infer<typeof YouTubeVideoDetailsSchema>
export type YouTubeVideoDetailsResponseType = z.infer<typeof YouTubeVideoDetailsResponseSchema>
