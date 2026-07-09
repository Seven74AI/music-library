import { type YouTubePlaylistItem, type YouTubePlaylist, type YouTubeVideo } from '#app/types/youtube-api'
import { parseDuration, type VideoData } from '#app/utils/youtube-utils'
import { type Prisma } from '#prisma/client.js'

/**
 * Structural thumbnail type so callers with provider-agnostic item shapes
 * (e.g. SyncableItem) can use the helper without depending on YouTube types.
 */
interface CoverThumbnails {
  maxres?: { url?: string } | null
  medium?: { url?: string } | null
  default?: { url?: string } | null
  // Present in YouTube responses but deliberately ignored (4:3 letterboxed)
  high?: { url?: string } | null
  standard?: { url?: string } | null
}

/**
 * Pick the best thumbnail URL to use as a cover image source.
 *
 * Preference: maxres (1280x720) > medium (320x180) > default (120x90).
 * maxres and medium are true 16:9 renditions; high (480x360) and
 * standard (640x480) are 4:3 with black letterbox bars, so they are
 * deliberately skipped — cropping them to a square cover would include
 * the bars. maxres only exists for some videos.
 */
export function pickCoverThumbnailUrl(
  thumbnails: CoverThumbnails | undefined,
): string | null {
  return (
    thumbnails?.maxres?.url ||
    thumbnails?.medium?.url ||
    thumbnails?.default?.url ||
    null
  )
}

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
  serviceId: string,
  artistId: string
): Omit<Prisma.TrackCreateInput, 'artist'> & { artistId: string; thumbnailUrl?: string | null } {
  // thumbnailUrl is returned for downloading, but not saved to database
  // It will be downloaded and stored as CoverImage instead
  return {
    title: item.snippet?.title || 'Unknown Title',
    artistId,
    // Duration is not in playlistItems responses — the archive worker backfills
    // it from the downloaded audio file (see worker.server.ts).
    duration: null,
    externalId: item.snippet?.resourceId?.videoId || '',
    service: { connect: { id: serviceId } },
    serviceUrl: item.snippet?.resourceId?.videoId ? `https://youtube.com/watch?v=${item.snippet.resourceId.videoId}` : null,
    thumbnailUrl: pickCoverThumbnailUrl(item.snippet?.thumbnails),
    // contentDetails.videoPublishedAt = when the video was published to YouTube.
    // snippet.publishedAt = when the item was ADDED TO THE PLAYLIST — never use it
    // as a release date.
    releaseDate: item.contentDetails?.videoPublishedAt
      ? new Date(item.contentDetails.videoPublishedAt)
      : null,
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
  serviceId: string,
  artistId: string
): Omit<Prisma.TrackCreateInput, 'artist'> & { artistId: string; thumbnailUrl?: string | null } {
  const duration = video.contentDetails?.duration ? parseDuration(video.contentDetails.duration) : null
  
  // thumbnailUrl is returned for downloading, but not saved to database
  // It will be downloaded and stored as CoverImage instead
  return {
    title: video.snippet?.title || 'Unknown Title',
    artistId,
    duration,
    externalId: video.id || '',
    service: { connect: { id: serviceId } },
    serviceUrl: video.id ? `https://youtube.com/watch?v=${video.id}` : null,
    thumbnailUrl: pickCoverThumbnailUrl(video.snippet?.thumbnails),
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
    thumbnailUrl: pickCoverThumbnailUrl(video.snippet?.thumbnails) || '',
    serviceUrl: video.id ? `https://youtube.com/watch?v=${video.id}` : '',
    publishedAt: video.snippet?.publishedAt || '',
  }
}
