import { z } from 'zod'

// YouTube video ID validation
const YouTubeVideoIdSchema = z.string().regex(
  /^[a-zA-Z0-9_-]{11}$/,
  'Invalid YouTube video ID format'
)

// Track validation schemas
export const TrackValidationSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title must be 200 characters or less'),
  artist: z.string().min(1, 'Artist is required').max(200, 'Artist must be 200 characters or less'),
  duration: z.number().int().min(1, 'Duration must be at least 1 second').max(86400, 'Duration cannot exceed 24 hours').optional(),
  serviceUrl: z.string().url('Invalid service URL').optional(),
  thumbnailUrl: z.string().url('Invalid thumbnail URL').optional(),
})

// Service-specific validation
export const YouTubeTrackValidationSchema = TrackValidationSchema.extend({
  serviceProviderId: YouTubeVideoIdSchema,
  serviceUrl: z.string().regex(
    /^https:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[a-zA-Z0-9_-]{11}$/,
    'Invalid YouTube URL format'
  ),
})

export const SpotifyTrackValidationSchema = TrackValidationSchema.extend({
  serviceProviderId: z.string().regex(
    /^[a-zA-Z0-9]{22}$/,
    'Invalid Spotify track ID format'
  ),
  serviceUrl: z.string().regex(
    /^https:\/\/open\.spotify\.com\/track\/[a-zA-Z0-9]{22}$/,
    'Invalid Spotify URL format'
  ),
})

// Validation functions
export function validateYouTubeTrack(data: unknown) {
  return YouTubeTrackValidationSchema.safeParse(data)
}

export function validateSpotifyTrack(data: unknown) {
  return SpotifyTrackValidationSchema.safeParse(data)
}

export function validateGenericTrack(data: unknown) {
  return TrackValidationSchema.safeParse(data)
}

// Service-specific validation based on service name
export function validateTrackForService(data: unknown, serviceName: string) {
  switch (serviceName) {
    case 'youtube':
      return validateYouTubeTrack(data)
    case 'spotify':
      return validateSpotifyTrack(data)
    default:
      return validateGenericTrack(data)
  }
}

// Utility to extract YouTube video ID from URL
export function extractYouTubeVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/
  ]
  
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match && match[1]) {
      return match[1]
    }
  }
  
  return null
}

// Utility to validate YouTube video ID
export function isValidYouTubeVideoId(videoId: string): boolean {
  return YouTubeVideoIdSchema.safeParse(videoId).success
}
