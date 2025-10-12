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
import { enqueueTrackForArchiving } from './track-enqueue.server'
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
   * Process tracks in batches for better performance
   * 
   * @param playlistItems - Array of playlist items to process
   * @param serviceId - The service ID
   * @param playlistId - The playlist ID
   * @param tx - Prisma transaction instance
   * @returns Number of processed tracks
   */
  private async processTracksInBatches(
    playlistItems: NewYouTubePlaylistItem[],
    serviceId: string,
    playlistId: string,
    tx: any
  ): Promise<number> {
    let processedTracks = 0
    const batchSize = 50
    
    for (let batchStart = 0; batchStart < playlistItems.length; batchStart += batchSize) {
      const batch = playlistItems.slice(batchStart, batchStart + batchSize)
      
      // Prepare batch data
      const trackDataBatch: TrackDataBatch[] = []
      
      for (let i = 0; i < batch.length; i++) {
        const item = batch[i] as NewYouTubePlaylistItem
        if (!item) continue
        
        try {
          const trackData = transformYouTubePlaylistItemToTrack(item, serviceId)
          trackDataBatch.push({
            serviceId,
            externalId: item.snippet?.resourceId?.videoId || '',
            trackData,
            position: batchStart + i + 1
          })
        } catch (error) {
          console.error(`Error preparing track ${item.snippet?.resourceId?.videoId || 'unknown'}:`, error)
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
      
      // Batch upsert playlist tracks
      const playlistTrackPromises = tracks.map((track, index) => {
        const trackData = trackDataBatch[index]
        if (!trackData) return null
        return tx.servicePlaylistTrack.upsert({
          where: {
            playlistId_trackId: {
              playlistId: playlistId,
              trackId: track.id
            }
          },
          update: {
            position: trackData.position
          },
          create: {
            playlistId: playlistId,
            trackId: track.id,
            position: trackData.position
          }
        })
      }).filter(Boolean)
      
      await Promise.all(playlistTrackPromises)
      processedTracks += tracks.length
    }
    
    return processedTracks
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
    const tracksAdded = await prisma.$transaction(async (tx) => {
      return this.processTracksInBatches(playlistItems, service.id, playlist.id, tx)
    })

    return {
      success: true,
      playlistId: playlist.id,
      tracksAdded,
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
            audioFile: {
              select: {
                objectKey: true,
                status: true,
                priority: true,
              }
            }
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
        position: pt.position
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
      service: undefined // Will be populated if needed
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
          
          // Enqueue track for archiving when reactivated
          await enqueueTrackForArchiving(trackId, false)
          
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
      
      // Enqueue track for archiving when added to library
      await enqueueTrackForArchiving(trackId, false)
      
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
  async resyncPlaylist(playlistId: string, userId: string): Promise<{ success: boolean; tracksAdded: number; totalTracks: number }> {
    try {
      // Get the playlist
      const playlist = await prisma.servicePlaylist.findUnique({
        where: { id: playlistId },
        include: { service: true }
      })
      
      if (!playlist) {
        return { success: false, tracksAdded: 0, totalTracks: 0 }
      }
      
      // Use the existing sync method
      const result = await this.syncPlaylistTracks(playlist.service.name, playlistId, userId)
      return result
    } catch (error) {
      console.error('Error resyncing playlist:', error)
      return { success: false, tracksAdded: 0, totalTracks: 0 }
    }
  }

  async syncPlaylistTracks(serviceName: string, playlistId: string, userId: string) {
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

    // Update playlist metadata
    await prisma.servicePlaylist.update({
      where: { id: playlist.id },
      data: {
        itemCount: playlistItems.length,
        lastSyncedAt: new Date()
      }
    })

    // Process tracks in batches for better performance
    const tracksAdded = await prisma.$transaction(async (tx) => {
      return this.processTracksInBatches(playlistItems, service.id, playlist.id, tx)
    })

    return {
      success: true,
      tracksAdded,
      totalTracks: playlistItems.length
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