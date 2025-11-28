// Prisma types used in transformations
import { YOUTUBE_SERVICE } from '#app/constants/services'
import { 
  type PlaylistWithTracks,
  type TrackWithUserStatus
} from '#app/types/frontend'
import { 
  transformYouTubePlaylistToServicePlaylist,
  transformYouTubePlaylistItemToTrack
} from '#app/types/transformations'
import { 
  type ValidatedOAuthConnection,
  type YouTubeTokenData
} from '#app/types/youtube'
import { 
  type YouTubePlaylist,
  type YouTubePlaylistItem as NewYouTubePlaylistItem
} from '#app/types/youtube-api'
import { prisma } from '#app/utils/db.server'
import { 
  validateYouTubeOAuth
} from '#app/utils/youtube-oauth-validation.server'
import { createYouTubeService } from './youtube.server'

/**
 * Extended playlist interface with sync status information
 * Combines YouTube playlist data with internal sync tracking
 */
interface PlaylistWithSyncStatus extends YouTubePlaylist {
  isSynced: boolean
  playlistInternalId: string | null
}

/**
 * Batch data structure for processing tracks in batches
 * Used for efficient database operations during playlist sync
 */
interface TrackDataBatch {
  serviceId: string
  externalId: string
  trackData: ReturnType<typeof transformYouTubePlaylistItemToTrack>
  position: number
  item: NewYouTubePlaylistItem
}

/**
 * Track information for sync reporting
 */
interface SyncTrackInfo {
  id: string
  title: string
  externalId: string
}

/**
 * Result from processing tracks in batches
 */
interface ProcessTracksResult {
  processedCount: number
  deletedTracks: SyncTrackInfo[]
  processedExternalIds: Set<string>
}


/**
 * Service class for managing service playlists (YouTube, Spotify, etc.)
 * Handles playlist synchronization, track management, and user library operations
 */
export class ServicePlaylistService {
  /**
   * Get service by name with error handling
   * 
   * @param serviceName - The name of the service to retrieve
   * @returns Promise resolving to the service record
   * @throws ServiceNotFoundError if service doesn't exist
   */
  private async getServiceByName(serviceName: string) {
    const service = await prisma.service.findUnique({
      where: { name: serviceName }
    })
    
    if (!service) {
      throw new ServiceNotFoundError(serviceName)
    }
    
    return service
  }

  /**
   * Get user connection for service with error handling
   * 
   * @param serviceName - The name of the service
   * @param userId - The user ID
   * @returns Promise resolving to the connection record
   * @throws NoTokensError if no connection or tokens found
   */
  private async getUserConnection(serviceName: string, userId: string) {
    const connection = await prisma.connection.findFirst({
      where: {
        providerName: serviceName,
        userId: userId
      }
    })

    if (!connection || !connection.tokens) {
      throw new NoTokensError(serviceName)
    }

    return connection
  }

  /**
   * Check if a YouTube playlist item represents a deleted video
   * 
   * @param item - YouTube playlist item to check
   * @returns true if the video appears to be deleted
   */
  private isDeletedYouTubeVideo(item: NewYouTubePlaylistItem): boolean {
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
    
    const hasDeletedTitle = deletedPatterns.some(pattern => pattern.test(title))
    const missingVideoId = !videoId || videoId.trim() === ''
    const missingThumbnail = !item.snippet?.thumbnails?.default?.url
    
    return hasDeletedTitle || missingVideoId || missingThumbnail
  }

  /**
   * Determine if we should preserve existing track data
   * 
   * @param existingTrack - Existing track from database
   * @param newItem - New item from YouTube API
   * @returns true if we should preserve existing data
   */
  private shouldPreserveTrackData(
    existingTrack: { title: string } | null,
    newItem: NewYouTubePlaylistItem
  ): boolean {
    if (!existingTrack) return false
    
    // Preserve if video is deleted and we have a real title (not "Deleted video")
    if (this.isDeletedYouTubeVideo(newItem) && existingTrack.title !== 'Deleted video' && existingTrack.title !== 'Unknown Title') {
      return true
    }
    
    return false
  }

  /**
   * Process tracks in batches for better performance
   * 
   * @param playlistItems - Array of playlist items to process
   * @param serviceId - The service ID
   * @param playlistId - The playlist ID
   * @param tx - Prisma transaction instance
   * @returns Result with processed count, deleted tracks, and processed external IDs
   */
  private async processTracksInBatches(
    playlistItems: NewYouTubePlaylistItem[],
    serviceId: string,
    playlistId: string,
    tx: any
  ): Promise<ProcessTracksResult> {
    let processedTracks = 0
    const batchSize = 50
    const deletedTracks: SyncTrackInfo[] = []
    const processedExternalIds = new Set<string>()
    
    for (let batchStart = 0; batchStart < playlistItems.length; batchStart += batchSize) {
      const batch = playlistItems.slice(batchStart, batchStart + batchSize)
      
      // Prepare batch data
      const trackDataBatch: TrackDataBatch[] = []
      
      for (let i = 0; i < batch.length; i++) {
        const item = batch[i] as NewYouTubePlaylistItem
        if (!item) continue
        
        const externalId = item.snippet?.resourceId?.videoId || ''
        
        try {
          // Get existing track to preserve data if needed
          const existingTrack = externalId ? await tx.track.findUnique({
            where: {
              serviceId_externalId: {
                serviceId,
                externalId
              }
            }
          }) : null
          
          // Determine if we should preserve existing track data
          const preserveData = this.shouldPreserveTrackData(existingTrack, item)
          
          let trackData: ReturnType<typeof transformYouTubePlaylistItemToTrack>
          if (preserveData && existingTrack) {
            // Preserve existing data, only update non-critical fields
            trackData = {
              ...transformYouTubePlaylistItemToTrack(item, serviceId),
              title: existingTrack.title,
              artist: existingTrack.artist,
              thumbnailUrl: existingTrack.thumbnailUrl,
            }
          } else {
            trackData = transformYouTubePlaylistItemToTrack(item, serviceId)
          }
          
          trackDataBatch.push({
            serviceId,
            externalId,
            trackData,
            position: batchStart + i + 1,
            item
          })
          
          // Only mark as processed after successful preparation
          if (externalId) {
            processedExternalIds.add(externalId)
          }
        } catch (error) {
          console.error(`Error preparing track ${item.snippet?.resourceId?.videoId || 'unknown'}:`, error)
          // externalId is NOT added to processedExternalIds on error, so it will be removed if it exists
        }
      }
      
      // Batch upsert tracks
      const trackPromises = trackDataBatch.map(async ({ serviceId, externalId, trackData }) => {
        return tx.track.upsert({
          where: {
            serviceId_externalId: {
              serviceId,
              externalId
            }
          },
          update: {
            ...trackData,
            updatedAt: new Date()
          },
          create: trackData
        })
      })
      
      const tracks = await Promise.all(trackPromises)
      
      // Batch upsert playlist tracks with deletion status
      const playlistTrackPromises = tracks.map(async (track, index) => {
        const trackData = trackDataBatch[index]
        if (!trackData) return null
        
        // Use the item stored with trackData to avoid index mismatch when items are skipped
        const item = trackData.item
        const isDeleted = item ? this.isDeletedYouTubeVideo(item) : false
        
        // Check if this track was previously deleted
        const existingPlaylistTrack = await tx.servicePlaylistTrack.findUnique({
          where: {
            playlistId_trackId: {
              playlistId: playlistId,
              trackId: track.id
            }
          }
        })
        
        const shouldSetDeletedAt = isDeleted && !existingPlaylistTrack?.isDeleted
        
        const result = await tx.servicePlaylistTrack.upsert({
          where: {
            playlistId_trackId: {
              playlistId: playlistId,
              trackId: track.id
            }
          },
          update: {
            position: trackData.position,
            isDeleted,
            deletedAt: shouldSetDeletedAt ? new Date() : (isDeleted ? existingPlaylistTrack?.deletedAt : null)
          },
          create: {
            playlistId: playlistId,
            trackId: track.id,
            position: trackData.position,
            isDeleted,
            deletedAt: isDeleted ? new Date() : null
          }
        })
        
        // Track deleted videos for reporting - only report newly detected deletions
        if (shouldSetDeletedAt) {
          deletedTracks.push({
            id: track.id,
            title: track.title,
            externalId: trackData.externalId
          })
        }
        
        return result
      }).filter(Boolean)
      
      await Promise.all(playlistTrackPromises)
      processedTracks += tracks.length
    }
    
    return {
      processedCount: processedTracks,
      deletedTracks,
      processedExternalIds
    }
  }

  /**
   * Parse connection tokens with error handling
   * 
   * @param connection - The connection record with tokens
   * @returns Parsed token data
   * @throws Error if tokens cannot be parsed
   */
  private parseConnectionTokens(connection: { tokens: string | null }): { access_token: string } {
    if (!connection.tokens) {
      throw new Error('No tokens found in connection')
    }

    try {
      const tokenData = JSON.parse(connection.tokens) as YouTubeTokenData
      
      if (!tokenData.access_token) {
        throw new Error('No access token found in connection tokens')
      }

      return {
        access_token: tokenData.access_token
      }
    } catch (error) {
      console.error('Error parsing connection tokens:', error)
      throw new Error('Failed to parse connection tokens')
    }
  }

  /**
   * Get all playlists for a service with sync status
   */
  async getAllPlaylistsWithSyncStatus(serviceName: string, userId: string): Promise<{
    playlists: PlaylistWithSyncStatus[]
    hasConnection: boolean
    service: {
      id: string
      name: string
      displayName: string
      baseUrl: string
      isActive: boolean
      createdAt: Date
      updatedAt: Date
    }
  }> {
    try {
      const service = await this.getServiceByName(serviceName)

      // Validate YouTube OAuth connection and tokens
      const validation: ValidatedOAuthConnection | null = await validateYouTubeOAuth(userId)
      
      if (!validation) {
        return {
          playlists: [],
          hasConnection: false,
          service
        }
      }

      // Get all playlists from the service API
      // For now, we only support YouTube - other services will be added later
      if (serviceName !== YOUTUBE_SERVICE.NAME) {
        throw new Error(`Service ${serviceName} is not yet supported`)
      }
      
      // Use YouTube service directly
      const youtubeService = createYouTubeService()
      const playlistsResponse = await youtubeService.getUserPlaylists(validation.tokenData.access_token)
      
      // getUserPlaylists already validates and returns YouTubePlaylistListResponse
      const allPlaylists = playlistsResponse.items || []

      // Get already synced playlists
      const syncedPlaylists = await prisma.servicePlaylist.findMany({
        where: {
          serviceId: service.id,
          ownerId: userId,
          isActive: true
        },
        select: {
          externalId: true,
          id: true
        }
      })

      const syncedPlaylistIds = new Set(syncedPlaylists.map(p => p.externalId))
      const syncedPlaylistInternalIds = new Map(syncedPlaylists.map(p => [p.externalId, p.id]))

      // Combine API playlists with sync status
      const playlistsWithSyncStatus: PlaylistWithSyncStatus[] = allPlaylists.map(playlist => ({
        ...playlist,
        isSynced: syncedPlaylistIds.has(playlist.id || ''),
        playlistInternalId: syncedPlaylistInternalIds.get(playlist.id || '') || null
      }))

      return {
        playlists: playlistsWithSyncStatus,
        hasConnection: true,
        service
      }
    } catch (error) {
      console.error(`Error fetching playlists for ${serviceName}:`, error)
      return {
        playlists: [],
        hasConnection: false,
        service: await this.getServiceByName(serviceName)
      }
    }
  }

  /**
   * Add playlist to sync (includes fetching tracks)
   */
  async addPlaylistToSync(serviceName: string, externalPlaylistId: string, userId: string) {
    const service = await this.getServiceByName(serviceName)
    const connection = await this.getUserConnection(serviceName, userId)
    const tokenData = this.parseConnectionTokens(connection)

    // For now, we only support YouTube - other services will be added later
    if (serviceName !== YOUTUBE_SERVICE.NAME) {
      throw new Error(`Service ${serviceName} is not yet supported`)
    }

    // Get playlist details and items using YouTube service directly
    const youtubeService = createYouTubeService()
    const [youtubePlaylist, playlistItems] = await Promise.all([
      youtubeService.getPlaylist(externalPlaylistId, tokenData.access_token),
      youtubeService.getPlaylistItems(externalPlaylistId, tokenData.access_token)
    ])

    // getPlaylist and getPlaylistItems already validate and return validated data
    // Transform playlist data using new type-safe architecture
    const playlistData = transformYouTubePlaylistToServicePlaylist(
      youtubePlaylist,
      service.id,
      userId
    )

    // Create or update playlist in database (Prisma handles validation)
    const playlist = await prisma.servicePlaylist.upsert({
      where: {
        serviceId_externalId: {
          serviceId: service.id,
          externalId: externalPlaylistId
        }
      },
      update: {
        ...playlistData,
        lastSyncedAt: new Date(),
        isActive: true
      },
      create: {
        ...playlistData,
        lastSyncedAt: new Date(),
        isActive: true
      }
    })

    // Process tracks in batches for better performance
    const processResult = await prisma.$transaction(async (tx) => {
      return this.processTracksInBatches(playlistItems, service.id, playlist.id, tx)
    })

    return {
      success: true,
      playlistId: playlist.id,
      tracksAdded: processResult.processedCount,
      totalTracks: playlistItems.length
    }
  }

  /**
   * Get synced playlists for a user
   */
  async getSyncedPlaylists(serviceName: string, userId: string) {
    const service = await this.getServiceByName(serviceName)
    
    return await prisma.servicePlaylist.findMany({
      where: {
        serviceId: service.id,
        ownerId: userId,
        isActive: true
      },
      orderBy: {
        updatedAt: 'desc'
      }
    })
  }

  /**
   * Remove playlist from sync
   */
  async removePlaylistFromSync(serviceName: string, id: string, userId: string) {
    // For now, we only support YouTube - other services will be added later
    if (serviceName !== YOUTUBE_SERVICE.NAME) {
      throw new Error(`Service ${serviceName} is not yet supported`)
    }

    const service = await this.getServiceByName(serviceName)
    
    try {
      const result = await prisma.servicePlaylist.deleteMany({
        where: {
          serviceId: service.id,
          id,
          ownerId: userId
        }
      })

      console.log('result', result, result.count > 0)

      return {
        success: result.count > 0,
        message: result.count > 0 
          ? 'Playlist removed from sync successfully' 
          : 'Playlist not found or already removed'
      }
    } catch (error) {
      console.error('Error removing playlist from sync:', error)
      return {
        success: false,
        message: 'Failed to remove playlist from sync'
      }
    }
  }

  /**
   * Get playlist tracks with details
   */
  async getPlaylistTracks(serviceName: string, playlistId: string, userId: string) {
    const service = await this.getServiceByName(serviceName)
    
    // Verify playlist belongs to user
    const playlist = await prisma.servicePlaylist.findFirst({
      where: {
        id: playlistId,
        serviceId: service.id,
        ownerId: userId,
        isActive: true
      }
    })

    if (!playlist) {
      throw new Error('Playlist not found or access denied')
    }

    // Get tracks with their details
    const playlistTracks = await prisma.servicePlaylistTrack.findMany({
      where: {
        playlistId: playlist.id
      },
      include: {
        track: {
          include: {
            service: {
              select: {
                name: true,
                displayName: true,
                logoUrl: true
              }
            },
            audioFiles: true
          }
        }
      },
      orderBy: {
        position: 'asc'
      }
    })

    return {
      playlist,
      tracks: playlistTracks.map(pt => ({
        ...pt.track,
        position: pt.position,
        isDeleted: pt.isDeleted,
        deletedAt: pt.deletedAt
      }))
    }
  }

  /**
   * Get playlist tracks with user library status for frontend display
   */
  async getPlaylistTracksWithUserStatus(playlistId: string, userId: string): Promise<{
    playlist: PlaylistWithTracks
    tracks: TrackWithUserStatus[]
  }> {
    // Get playlist with tracks
    const result = await this.getPlaylistTracks('youtube', playlistId, userId)
    
    // Get user's active library tracks for status check
    const userTracks = await prisma.userTrack.findMany({
      where: {
        userId: userId,
        isActive: true
      },
      select: {
        trackId: true
      }
    })
    
    const userTrackIds = new Set(userTracks.map(ut => ut.trackId))
    
    // Transform to type-safe frontend format
    const playlist: PlaylistWithTracks = {
      ...result.playlist,
      tracks: []
    }
    
    const tracks: TrackWithUserStatus[] = result.tracks.map(track => ({
      ...track,
      isInUserLibrary: userTrackIds.has(track.id),
      isDeleted: track.isDeleted || false,
      deletedAt: track.deletedAt || null,
      service: track.service ? {
        name: track.service.name,
        displayName: track.service.displayName,
        logoUrl: track.service.logoUrl
      } : undefined,
      audioFiles: track.audioFiles?.map(af => ({
        id: af.id,
        format: af.format,
        objectKey: af.objectKey
      }))
    }))
    
    // Update playlist tracks
    playlist.tracks = tracks
    
    return {
      playlist,
      tracks
    }
  }

  /**
   * Sync playlist tracks (refresh from service)
   */
  /**
   * Adds a track to the user's library, handling soft-deleted track reactivation
   * 
   * This method performs the following operations:
   * 1. Validates that the track exists in the database
   * 2. Checks if the user already has this track in their library
   * 3. If the track was previously soft-deleted, reactivates it
   * 4. If the track is new to the user, creates a new UserTrack record
   * 
   * @param userId - The ID of the user adding the track
   * @param trackId - The ID of the track to add to the user's library
   * @returns Promise resolving to success status
   * @throws {ServiceNotFoundError} If the service is not found
   * @throws {TrackNotFoundError} If the track is not found
   * @example
   * ```typescript
   * const result = await service.addTrackToUserLibrary('user123', 'track456')
   * if (result.success) {
   *   console.log('Track added successfully')
   * }
   * ```
   */
  async addTrackToUserLibrary(userId: string, trackId: string): Promise<{ success: boolean }> {
    try {
      // Check if track exists
      const track = await prisma.track.findUnique({
        where: { id: trackId }
      })
      
      if (!track) {
        return { success: false }
      }
      
      // Check if user already has this track
      const existingUserTrack = await prisma.userTrack.findUnique({
        where: {
          userId_trackId: {
            userId,
            trackId
          }
        }
      })
      
      if (existingUserTrack) {
        if (existingUserTrack.isActive) {
          return { success: true } // Already exists and is active
        } else {
          // Reactivate soft-deleted track
          await prisma.userTrack.update({
            where: {
              userId_trackId: {
                userId,
                trackId
              }
            },
            data: {
              isActive: true,
              deletedAt: null
            }
          })
          
          return { success: true } // Reactivated
        }
      }
      
      // Add track to user's library
      await prisma.userTrack.create({
        data: {
          userId,
          trackId,
          isActive: true
        }
      })
      
      return { success: true }
    } catch (error) {
      console.error('Error adding track to user library:', error)
      return { success: false }
    }
  }

  /**
   * Removes a track from the user's library using soft delete
   * 
   * This method performs a soft delete by setting `isActive: false` and `deletedAt: timestamp`
   * instead of permanently removing the record. This allows for data recovery and audit trails.
   * 
   * @param userId - The ID of the user removing the track
   * @param trackId - The ID of the track to remove from the user's library
   * @returns Promise resolving to success status (true if record was updated, false if not found)
   * @example
   * ```typescript
   * const result = await service.removeTrackFromUserLibrary('user123', 'track456')
   * if (result.success) {
   *   console.log('Track removed successfully')
   * } else {
   *   console.log('Track was not found in user library')
   * }
   * ```
   */
  async removeTrackFromUserLibrary(userId: string, trackId: string): Promise<{ success: boolean }> {
    try {
      const result = await prisma.userTrack.updateMany({
        where: {
          userId,
          trackId,
        },
        data: {
          isActive: false,
          deletedAt: new Date()
        }
      })
      
      return { success: result.count > 0 }
    } catch (error) {
      console.error('Error removing track from user library:', error)
      return { success: false }
    }
  }

  /**
   * Resync a playlist (refresh tracks from external service)
   * 
   * @param playlistId - The playlist ID to resync
   * @param userId - The user ID
   * @returns Promise resolving to sync result
   */
  async resyncPlaylist(
    playlistId: string, 
    userId: string
  ): Promise<{
    success: boolean
    tracksAdded: number
    totalTracks: number
    deletedTracks: SyncTrackInfo[]
    removedTracks: SyncTrackInfo[]
  }> {
    try {
      // Get the playlist
      const playlist = await prisma.servicePlaylist.findUnique({
        where: { id: playlistId },
        include: { service: true }
      })
      
      if (!playlist) {
        return { 
          success: false, 
          tracksAdded: 0, 
          totalTracks: 0,
          deletedTracks: [],
          removedTracks: []
        }
      }
      
      // Use the existing sync method
      const result = await this.syncPlaylistTracks(playlist.service.name, playlistId, userId)
      return result
    } catch (error) {
      console.error('Error resyncing playlist:', error)
      return { 
        success: false, 
        tracksAdded: 0, 
        totalTracks: 0,
        deletedTracks: [],
        removedTracks: []
      }
    }
  }

  async syncPlaylistTracks(
    serviceName: string, 
    playlistId: string, 
    userId: string
  ): Promise<{
    success: boolean
    tracksAdded: number
    totalTracks: number
    deletedTracks: SyncTrackInfo[]
    removedTracks: SyncTrackInfo[]
  }> {
    const service = await this.getServiceByName(serviceName)
    const connection = await this.getUserConnection(serviceName, userId)
    const tokenData = this.parseConnectionTokens(connection)

    // Get playlist details
    const playlist = await prisma.servicePlaylist.findFirst({
      where: {
        id: playlistId,
        serviceId: service.id,
        ownerId: userId,
        isActive: true
      }
    })

    if (!playlist) {
      throw new Error('Playlist not found or access denied')
    }

    // For now, we only support YouTube - other services will be added later
    if (serviceName !== YOUTUBE_SERVICE.NAME) {
      throw new Error(`Service ${serviceName} is not yet supported`)
    }

    // Get fresh playlist items from YouTube service
    const youtubeService = createYouTubeService()
    const playlistItems = await youtubeService.getPlaylistItems(playlist.externalId, tokenData.access_token)

    // Process tracks in batches and get results
    const processResult = await prisma.$transaction(async (tx) => {
      return this.processTracksInBatches(playlistItems, service.id, playlist.id, tx)
    })

    // Find tracks that were removed from playlist (exist in DB but not in current sync)
    const existingPlaylistTracks = await prisma.servicePlaylistTrack.findMany({
      where: {
        playlistId: playlist.id
      },
      include: {
        track: {
          select: {
            id: true,
            title: true,
            externalId: true
          }
        }
      }
    })

    const removedTracks: SyncTrackInfo[] = []
    const tracksToRemove: string[] = []

    for (const playlistTrack of existingPlaylistTracks) {
      const externalId = playlistTrack.track.externalId
      if (externalId && !processResult.processedExternalIds.has(externalId)) {
        // This track is no longer in the YouTube playlist
        removedTracks.push({
          id: playlistTrack.track.id,
          title: playlistTrack.track.title,
          externalId
        })
        tracksToRemove.push(playlistTrack.id)
      }
    }

    // Remove tracks that are no longer in the playlist
    if (tracksToRemove.length > 0) {
      await prisma.servicePlaylistTrack.deleteMany({
        where: {
          id: {
            in: tracksToRemove
          }
        }
      })
    }

    // Update playlist metadata
    await prisma.servicePlaylist.update({
      where: { id: playlist.id },
      data: {
        itemCount: playlistItems.length,
        lastSyncedAt: new Date()
      }
    })

    return {
      success: true,
      tracksAdded: processResult.processedCount,
      totalTracks: playlistItems.length,
      deletedTracks: processResult.deletedTracks,
      removedTracks
    }
  }
}

/**
 * Error class for when a service is not found in the database
 * @param serviceName - The name of the service that was not found
 */
export class ServiceNotFoundError extends Error {
  constructor(serviceName: string) {
    super(`Service not found: ${serviceName}`)
    this.name = 'ServiceNotFoundError'
  }
}

/**
 * Error class for when no valid tokens are found for a service
 * @param serviceName - The name of the service that lacks tokens
 */
export class NoTokensError extends Error {
  constructor(serviceName: string) {
    super(`No valid tokens found for service: ${serviceName}`)
    this.name = 'NoTokensError'
  }
}

/**
 * Factory function to create a new ServicePlaylistService instance
 * @returns A new instance of ServicePlaylistService
 */
export function createServicePlaylistService(): ServicePlaylistService {
  return new ServicePlaylistService()
}