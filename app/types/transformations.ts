import { type Prisma } from '@prisma/client'
import { type YouTubePlaylistItem, type YouTubePlaylist, type YouTubeVideo } from '#app/types/youtube-api'
import { parseDuration, type VideoData } from '#app/utils/youtube-utils'

/**
 * Type-safe transformation from YouTube API to Prisma input types
 * 
 * This file contains transformation functions that convert validated YouTube API data
 * into Prisma input types. All transformations are type-safe and direct.
 * 
 * @example
 * ```typescript
 * const trackData = transformYouTubePlaylistItemToTrack(
 *   validatedYouTubeItem,
 *   serviceId
 * )
 * // Returns: Prisma.TrackCreateInput
 * ```
 * 
 * @see {@link ../types/youtube-api.ts} for YouTube API types
 * @see {@link https://www.prisma.io/docs/reference/api-reference/prisma-client-reference} for Prisma types
 */

/**
 * Transforms a validated YouTube playlist item into Prisma Track input data
 * 
 * This function extracts relevant data from a YouTube API playlist item response
 * and formats it for database insertion using Prisma's type-safe input format.
 * 
 * @param item - Validated YouTube playlist item from API response
 * @param serviceId - The service ID to associate with the track
 * @returns Prisma TrackCreateInput object ready for database insertion
 * @example
 * ```typescript
 * const trackData = transformYouTubePlaylistItemToTrack(validatedItem, 'youtube-service-id')
 * const track = await prisma.track.create({ data: trackData })
 * ```
 */
export function transformYouTubePlaylistItemToTrack(
  item: YouTubePlaylistItem, 
  serviceId: string
): Prisma.TrackCreateInput {
  return {
    title: item.snippet?.title || 'Unknown Title',
    artist: item.snippet?.videoOwnerChannelTitle || item.snippet?.channelTitle || 'Unknown Artist',
    album: null, // YouTube doesn't provide album info
    duration: null, // Duration is not available in playlist items, need to fetch from video details
    externalId: item.snippet?.resourceId?.videoId || '',
    service: { connect: { id: serviceId } },
    serviceUrl: item.snippet?.resourceId?.videoId ? `https://youtube.com/watch?v=${item.snippet.resourceId.videoId}` : null,
    thumbnailUrl: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || null,
    releaseDate: null,
  }
}

/**
 * Transforms a validated YouTube playlist into Prisma ServicePlaylist input data
 * 
 * This function extracts relevant data from a YouTube API playlist response
 * and formats it for database insertion using Prisma's type-safe input format.
 * 
 * @param playlist - Validated YouTube playlist from API response
 * @param serviceId - The service ID to associate with the playlist
 * @param ownerId - The user ID who owns this playlist
 * @returns Prisma ServicePlaylistCreateInput object ready for database insertion
 * @example
 * ```typescript
 * const playlistData = transformYouTubePlaylistToServicePlaylist(validatedPlaylist, 'youtube-service-id', 'user123')
 * const playlist = await prisma.servicePlaylist.create({ data: playlistData })
 * ```
 */
export function transformYouTubePlaylistToServicePlaylist(
  playlist: YouTubePlaylist,
  serviceId: string,
  ownerId: string
): Prisma.ServicePlaylistCreateInput {
  return {
    title: playlist.snippet?.title || 'Unknown Playlist',
    description: playlist.snippet?.description || null,
    externalId: playlist.id || '',
    owner: { connect: { id: ownerId } },
    service: { connect: { id: serviceId } },
    itemCount: playlist.contentDetails?.itemCount || 0,
    channelId: playlist.snippet?.channelId || null,
    channelTitle: playlist.snippet?.channelTitle || null,
    thumbnailUrl: playlist.snippet?.thumbnails?.medium?.url || playlist.snippet?.thumbnails?.default?.url || null,
  }
}

/**
 * Transform YouTube API video details to Prisma Track input
 * 
 * @param video - Validated YouTube video details
 * @param serviceId - Service ID for the track
 * @returns Prisma TrackCreateInput for database insertion
 */
export function transformYouTubeVideoToTrack(
  video: YouTubeVideo,
  serviceId: string
): Prisma.TrackCreateInput {
  const duration = video.contentDetails?.duration ? parseDuration(video.contentDetails.duration) : null
  
  return {
    title: video.snippet?.title || 'Unknown Title',
    artist: video.snippet?.channelTitle || 'Unknown Artist',
    album: null, // YouTube doesn't provide album info
    duration,
    externalId: video.id || '',
    service: { connect: { id: serviceId } },
    serviceUrl: video.id ? `https://youtube.com/watch?v=${video.id}` : null,
    thumbnailUrl: video.snippet?.thumbnails?.medium?.url || video.snippet?.thumbnails?.default?.url || null,
    releaseDate: video.snippet?.publishedAt ? new Date(video.snippet.publishedAt) : null,
  }
}

/**
 * Transform YouTube API video details to VideoData format (for service-import)
 * 
 * @param video - Validated YouTube video details
 * @returns VideoData format for service import
 */
export function transformYouTubeVideoToVideoData(video: YouTubeVideo): VideoData {
  const duration = video.contentDetails?.duration ? parseDuration(video.contentDetails.duration) : null
  
  return {
    id: video.id || '',
    title: video.snippet?.title || 'Unknown Title',
    artist: video.snippet?.channelTitle || 'Unknown Artist',
    duration,
    thumbnailUrl: video.snippet?.thumbnails?.medium?.url || video.snippet?.thumbnails?.default?.url || '',
    serviceUrl: video.id ? `https://youtube.com/watch?v=${video.id}` : '',
    publishedAt: video.snippet?.publishedAt || '',
  }
}
