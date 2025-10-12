/**
 * Common YouTube utility functions
 * Centralized functions to avoid code duplication across YouTube-related modules
 */

// Common types for YouTube data transformation
export interface YouTubeThumbnails {
  default?: { url: string; width?: number; height?: number }
  medium?: { url: string; width?: number; height?: number }
  high?: { url: string; width?: number; height?: number }
  standard?: { url: string; width?: number; height?: number }
  maxres?: { url: string; width?: number; height?: number }
}

export interface VideoData {
  id: string
  title: string
  artist: string
  duration: number | null
  thumbnailUrl: string
  serviceUrl: string
  publishedAt: string
}

/**
 * Extract the best available thumbnail URL from YouTube thumbnails object
 * Priority: maxres > standard > high > medium > default
 */
export function getBestThumbnailUrl(thumbnails?: YouTubeThumbnails): string {
  if (!thumbnails) return ''
  
  return thumbnails.maxres?.url || 
         thumbnails.standard?.url || 
         thumbnails.high?.url || 
         thumbnails.medium?.url || 
         thumbnails.default?.url || 
         ''
}

/**
 * Build YouTube watch URL from video ID
 */
export function buildYouTubeUrl(videoId: string): string {
  return `https://youtube.com/watch?v=${videoId}`
}

/**
 * Transform YouTube video data to our common VideoData format
 */
export function transformVideoData(
  video: {
    id: string
    snippet: {
      title: string
      channelTitle: string
      publishedAt: string
      thumbnails?: YouTubeThumbnails
    }
    contentDetails?: {
      duration: string
    }
  },
  duration: number
): VideoData {
  return {
    id: video.id,
    title: video.snippet.title,
    artist: video.snippet.channelTitle,
    duration,
    thumbnailUrl: getBestThumbnailUrl(video.snippet.thumbnails),
    serviceUrl: buildYouTubeUrl(video.id),
    publishedAt: video.snippet.publishedAt,
  }
}

/**
 * Convert ISO 8601 duration to seconds
 * PT4M13S -> 253 seconds
 * Returns null for invalid or empty durations
 */
export function parseDuration(duration: string): number | null {
  if (!duration || duration.trim() === '') return null
  
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return null
  
  const hours = parseInt(match[1] || '0', 10)
  const minutes = parseInt(match[2] || '0', 10)
  const seconds = parseInt(match[3] || '0', 10)
  
  const totalSeconds = hours * 3600 + minutes * 60 + seconds
  return totalSeconds > 0 ? totalSeconds : null
}
