import { z } from 'zod'

/**
 * YouTube API Type Safety Architecture
 * 
 * This file uses official Google APIs TypeScript types and provides Zod schemas
 * for validation. All API data should be validated using these schemas before processing.
 * 
 * @example
 * ```typescript
 * const response = validateYouTubeAPIResponse(
 *   await fetchYouTubePlaylists(),
 *   YouTubePlaylistListResponseSchema
 * )
 * ```
 * 
 * @see {@link ../utils/validation.ts} for validation utilities
 * @see {@link ../types/transformations.ts} for data transformations
 */

// Official Google APIs types for reference
// Our types are inferred from Zod schemas below

// Zod schemas that match the official Google APIs types
// These provide runtime validation while maintaining type safety

export const YouTubeThumbnailSchema = z.object({
  url: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
})

export const YouTubeThumbnailsSchema = z.object({
  default: YouTubeThumbnailSchema.optional(),
  medium: YouTubeThumbnailSchema.optional(),
  high: YouTubeThumbnailSchema.optional(),
  standard: YouTubeThumbnailSchema.optional(),
  maxres: YouTubeThumbnailSchema.optional(),
})

export const YouTubePlaylistSnippetSchema = z.object({
  publishedAt: z.string().optional(),
  channelId: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  thumbnails: YouTubeThumbnailsSchema.optional(),
  channelTitle: z.string().optional(),
  defaultLanguage: z.string().optional(),
  localized: z.object({
    title: z.string(),
    description: z.string(),
  }).optional(),
})

export const YouTubePlaylistContentDetailsSchema = z.object({
  itemCount: z.number().optional(),
})

export const YouTubePlaylistStatusSchema = z.object({
  privacyStatus: z.string().optional(),
})

export const YouTubePlaylistSchema = z.object({
  kind: z.string().optional(),
  etag: z.string().optional(),
  id: z.string().optional(),
  snippet: YouTubePlaylistSnippetSchema.optional(),
  contentDetails: YouTubePlaylistContentDetailsSchema.optional(),
  status: YouTubePlaylistStatusSchema.optional(),
})

export const YouTubePlaylistListResponseSchema = z.object({
  kind: z.string().optional(),
  etag: z.string().optional(),
  nextPageToken: z.string().optional(),
  prevPageToken: z.string().optional(),
  pageInfo: z.object({
    totalResults: z.number().optional(),
    resultsPerPage: z.number().optional(),
  }).optional(),
  items: z.array(YouTubePlaylistSchema).optional(),
})

export const YouTubePlaylistItemSnippetSchema = z.object({
  publishedAt: z.string().optional(),
  channelId: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  thumbnails: YouTubeThumbnailsSchema.optional(),
  channelTitle: z.string().optional(),
  videoOwnerChannelTitle: z.string().optional(),
  videoOwnerChannelId: z.string().optional(),
  playlistId: z.string().optional(),
  position: z.number().optional(),
  resourceId: z.object({
    kind: z.string().optional(),
    videoId: z.string().optional(),
  }).optional(),
})

export const YouTubePlaylistItemContentDetailsSchema = z.object({
  videoId: z.string().optional(),
  startAt: z.string().optional(),
  endAt: z.string().optional(),
  note: z.string().optional(),
  videoPublishedAt: z.string().optional(),
})

export const YouTubePlaylistItemSchema = z.object({
  kind: z.string().optional(),
  etag: z.string().optional(),
  id: z.string().optional(),
  snippet: YouTubePlaylistItemSnippetSchema.optional(),
  contentDetails: YouTubePlaylistItemContentDetailsSchema.optional(),
})

export const YouTubePlaylistItemListResponseSchema = z.object({
  kind: z.string().optional(),
  etag: z.string().optional(),
  nextPageToken: z.string().optional(),
  prevPageToken: z.string().optional(),
  pageInfo: z.object({
    totalResults: z.number().optional(),
    resultsPerPage: z.number().optional(),
  }).optional(),
  items: z.array(YouTubePlaylistItemSchema).optional(),
})

export const YouTubeSearchResultSchema = z.object({
  kind: z.string().optional(),
  etag: z.string().optional(),
  id: z.object({
    kind: z.string().optional(),
    videoId: z.string().optional(),
  }).optional(),
  snippet: z.object({
    publishedAt: z.string().optional(),
    channelId: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    thumbnails: YouTubeThumbnailsSchema.optional(),
    channelTitle: z.string().optional(),
  }).optional(),
})

export const YouTubeSearchResponseSchema = z.object({
  kind: z.string().optional(),
  etag: z.string().optional(),
  nextPageToken: z.string().optional(),
  prevPageToken: z.string().optional(),
  pageInfo: z.object({
    totalResults: z.number().optional(),
    resultsPerPage: z.number().optional(),
  }).optional(),
  items: z.array(YouTubeSearchResultSchema).optional(),
})

export const YouTubeVideoContentDetailsSchema = z.object({
  duration: z.string().optional(),
  dimension: z.string().optional(),
  definition: z.string().optional(),
  caption: z.string().optional(),
  licensedContent: z.boolean().optional(),
  contentRating: z.any().optional(),
  projection: z.string().optional(),
})

export const YouTubeVideoSnippetSchema = z.object({
  publishedAt: z.string().optional(),
  channelId: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  thumbnails: YouTubeThumbnailsSchema.optional(),
  channelTitle: z.string().optional(),
})

export const YouTubeVideoSchema = z.object({
  kind: z.string().optional(),
  etag: z.string().optional(),
  id: z.string().optional(),
  snippet: YouTubeVideoSnippetSchema.optional(),
  contentDetails: YouTubeVideoContentDetailsSchema.optional(),
})

export const YouTubeVideoListResponseSchema = z.object({
  kind: z.string().optional(),
  etag: z.string().optional(),
  pageInfo: z.object({
    totalResults: z.number().optional(),
    resultsPerPage: z.number().optional(),
  }).optional(),
  items: z.array(YouTubeVideoSchema).optional(),
})

// Inferred TypeScript types from Zod schemas
export type YouTubeThumbnail = z.infer<typeof YouTubeThumbnailSchema>
export type YouTubeThumbnails = z.infer<typeof YouTubeThumbnailsSchema>
export type YouTubePlaylist = z.infer<typeof YouTubePlaylistSchema>
export type YouTubePlaylistItem = z.infer<typeof YouTubePlaylistItemSchema>
export type YouTubeSearchResult = z.infer<typeof YouTubeSearchResultSchema>
export type YouTubeVideo = z.infer<typeof YouTubeVideoSchema>
export type YouTubePlaylistListResponse = z.infer<typeof YouTubePlaylistListResponseSchema>
export type YouTubePlaylistItemListResponse = z.infer<typeof YouTubePlaylistItemListResponseSchema>
export type YouTubeSearchResponse = z.infer<typeof YouTubeSearchResponseSchema>
export type YouTubeVideoListResponse = z.infer<typeof YouTubeVideoListResponseSchema>