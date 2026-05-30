import { YOUTUBE_SERVICE } from '#app/constants/services'
import { type YouTubePlaylist, type YouTubePlaylistItem } from '#app/types/youtube-api'
import { transformYouTubePlaylistItemToTrack } from '#app/types/transformations'
import { type Prisma } from '#prisma/client.js'
import { type PlaylistSyncProvider } from './playlist-sync-provider.server'
import { createYouTubeService, type YouTubeService } from './youtube.server'

/**
 * YouTube implementation of PlaylistSyncProvider.
 *
 * Encapsulates all YouTube-specific logic:
 * - API call orchestration (delegates to YouTubeService)
 * - Deleted video detection (regex patterns on snippet title + missing fields)
 * - Track data preservation decisions (keep original title for deleted videos)
 * - Item-to-Prisma transformation (delegates to transformYouTubePlaylistItemToTrack)
 *
 * ## Reusable local helpers
 *
 * These methods (`isDeletedVideo`, `shouldPreserveTrackData`) are public on the
 * provider so the facade's `processTracksInBatches` can call them during sync.
 *
 * @example
 * ```typescript
 * const provider = createYouTubePlaylistProvider()
 * const playlists = await provider.fetchPlaylists(accessToken, userId)
 * ```
 */
export class YouTubePlaylistProvider implements PlaylistSyncProvider {
  private youtubeService: YouTubeService

  constructor(youtubeService?: YouTubeService) {
    this.youtubeService = youtubeService ?? createYouTubeService()
  }

  /**
   * Check if a YouTube playlist item represents a deleted video.
   *
   * Detection uses:
   * 1. Title matches common deleted/private/unavailable video patterns
   * 2. Missing video ID in resourceId
   * 3. Missing thumbnail URL
   *
   * @param item - YouTube playlist item to check
   * @returns true if the video appears to be deleted
   */
  isDeletedVideo(item: YouTubePlaylistItem): boolean {
    const title = item.snippet?.title || ''
    const videoId = item.snippet?.resourceId?.videoId

    // Check for common deleted video patterns
    const deletedPatterns = [
      /^deleted video$/i,
      /^private video$/i,
      /^unavailable video$/i,
      /^video unavailable$/i,
      /^this video is unavailable$/i,
    ]

    const hasDeletedTitle = deletedPatterns.some((pattern) => pattern.test(title))
    const missingVideoId = !videoId || videoId.trim() === ''
    const missingThumbnail = !item.snippet?.thumbnails?.default?.url

    return hasDeletedTitle || missingVideoId || missingThumbnail
  }

  /**
   * Determine if we should preserve existing track data.
   *
   * Preserves when the video is deleted AND we have a meaningful original title
   * (not "Deleted video" or "Unknown Title").
   *
   * @param existingTrack - Existing track from database
   * @param newItem - New item from YouTube API
   * @returns true if we should preserve existing data
   */
  shouldPreserveTrackData(
    existingTrack: { title: string } | null,
    newItem: YouTubePlaylistItem,
  ): boolean {
    if (!existingTrack) return false

    // Preserve if video is deleted and we have a real title (not "Deleted video")
    if (
      this.isDeletedVideo(newItem) &&
      existingTrack.title !== 'Deleted video' &&
      existingTrack.title !== 'Unknown Title'
    ) {
      return true
    }

    return false
  }

  /**
   * Fetch all user playlists from YouTube.
   * Delegates to YouTubeService.getUserPlaylists which handles pagination.
   */
  async fetchPlaylists(token: string, _userId: string): Promise<YouTubePlaylist[]> {
    return this.youtubeService.getUserPlaylists(token)
  }

  /**
   * Fetch a single YouTube playlist by ID.
   * Delegates to YouTubeService.getPlaylist.
   */
  async fetchPlaylist(externalId: string, token: string): Promise<YouTubePlaylist> {
    return this.youtubeService.getPlaylist(externalId, token)
  }

  /**
   * Fetch all items in a YouTube playlist.
   * Delegates to YouTubeService.getPlaylistItems which handles pagination.
   */
  async fetchPlaylistItems(
    externalId: string,
    token: string,
  ): Promise<YouTubePlaylistItem[]> {
    return this.youtubeService.getPlaylistItems(externalId, token)
  }

  /**
   * Check if this provider supports the given service name.
   */
  supportsService(serviceName: string): boolean {
    return serviceName === YOUTUBE_SERVICE.NAME
  }

  /**
   * Transform a YouTube playlist item into Prisma TrackCreateInput.
   * Delegates to the shared transformYouTubePlaylistItemToTrack function.
   */
  transformPlaylistItem(
    item: YouTubePlaylistItem,
    serviceId: string,
    artistId: string,
  ): Omit<Prisma.TrackCreateInput, 'artist'> & { artistId: string; thumbnailUrl?: string | null } {
    return transformYouTubePlaylistItemToTrack(item, serviceId, artistId)
  }
}

/**
 * Factory function to create a new YouTubePlaylistProvider instance.
 *
 * @param youtubeService - Optional pre-configured YouTubeService (useful for testing)
 * @returns A new YouTubePlaylistProvider
 */
export function createYouTubePlaylistProvider(
  youtubeService?: YouTubeService,
): YouTubePlaylistProvider {
  return new YouTubePlaylistProvider(youtubeService)
}
