import type { YouTubePlaylist, YouTubePlaylistItem } from '#app/types/youtube-api'
import type { Prisma } from '#prisma/client.js'

/**
 * Interface for playlist sync providers.
 *
 * Each provider encapsulates the logic for a specific external service
 * (YouTube, Spotify, etc.). The facade (`ServicePlaylistService`) delegates
 * service-specific operations to the appropriate provider via this interface.
 *
 * ## Contract for future providers
 *
 * A provider must:
 * 1. Handle ALL API calls to its external service (fetchPlaylists, fetchPlaylist, fetchPlaylistItems)
 * 2. Implement `supportsService` to identify which service name(s) it handles
 * 3. Detect deleted/unavailable content via `isDeletedVideo`
 * 4. Decide whether to preserve existing track data via `shouldPreserveTrackData`
 * 5. Transform service-specific items to Prisma input via `transformPlaylistItem`
 *
 * Non-goals (handled by facade):
 * - Database transactions (Prisma writes)
 * - OAuth token validation (handled by shared oauth-validation modules)
 * - Batch processing orchestration (processTracksInBatches stays in facade)
 * - Image processing (cover images handled by facade)
 *
 * @example
 * ```typescript
 * // Adding a Spotify provider in the future:
 * class SpotifyPlaylistProvider implements PlaylistSyncProvider {
 *   fetchPlaylists(token, userId) { ... }
 *   fetchPlaylist(externalId, token) { ... }
 *   // etc.
 * }
 * ```
 */
export interface PlaylistSyncProvider {
  /**
   * Fetch all user playlists from the external service.
   *
   * @param token - OAuth access token for the service
   * @param userId - The authenticated user's ID
   * @returns Promise resolving to an array of playlist objects
   */
  fetchPlaylists(token: string, userId: string): Promise<YouTubePlaylist[]>

  /**
   * Fetch a single playlist by external ID from the service.
   *
   * @param externalId - The service-specific playlist identifier (e.g., YouTube playlist ID)
   * @param token - OAuth access token for the service
   * @returns Promise resolving to the playlist object
   */
  fetchPlaylist(externalId: string, token: string): Promise<YouTubePlaylist>

  /**
   * Fetch all items (tracks/videos) in a playlist from the external service.
   * Handles pagination internally to return the complete list.
   *
   * @param externalId - The service-specific playlist identifier
   * @param token - OAuth access token for the service
   * @returns Promise resolving to an array of playlist item objects
   */
  fetchPlaylistItems(externalId: string, token: string): Promise<YouTubePlaylistItem[]>

  /**
   * Check whether this provider supports a given service name.
   * Used by the facade for provider resolution.
   *
   * @param serviceName - The service name to check (e.g., 'youtube', 'spotify')
   * @returns true if this provider handles the service
   */
  supportsService(serviceName: string): boolean

  /**
   * Detect whether a playlist item represents deleted or unavailable content.
   * Service-specific detection logic (regex patterns, missing fields, etc.).
   *
   * @param item - The playlist item to inspect
   * @returns true if the content appears to be deleted/unavailable
   */
  isDeletedVideo(item: YouTubePlaylistItem): boolean

  /**
   * Determine whether existing track data should be preserved over new API data.
   * Typically used for deleted videos where we want to keep the original title.
   *
   * @param existingTrack - The existing track record (or null if new)
   * @param newItem - The new item from the service API
   * @returns true if existing data should be preserved
   */
  shouldPreserveTrackData(
    existingTrack: { title: string } | null,
    newItem: YouTubePlaylistItem,
  ): boolean

  /**
   * Transform a service-specific playlist item into Prisma TrackCreateInput.
   * Encapsulates the mapping between external service data shapes and internal models.
   *
   * @param item - The service-specific playlist item
   * @param serviceId - The internal service ID
   * @param artistId - The resolved artist ID for the track
   * @returns Prisma-compatible track creation data
   */
  transformPlaylistItem(
    item: YouTubePlaylistItem,
    serviceId: string,
    artistId: string,
  ): Omit<Prisma.TrackCreateInput, 'artist'> & { artistId: string; thumbnailUrl?: string | null }
}
