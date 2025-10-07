import { YOUTUBE_SERVICE } from '#app/constants/services'
import { type YouTubePlaylist, type YouTubePlaylistListResponse } from '#app/types/youtube'
import { prisma } from '#app/utils/db.server'
import { createMusicService } from './service-factory.server'
import { 
  ServiceNotFoundError, 
  PlaylistNotFoundError, 
  NoTokensError 
} from './youtube-errors'
import { validateYouTubeOAuth } from './youtube-oauth-validation.server'
import { getBestThumbnailUrl, buildYouTubeUrl } from './youtube-utils'

/**
 * Type for playlists with sync status
 */
interface PlaylistWithSyncStatus extends YouTubePlaylist {
  playlistInternalId: string | null
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
        userId: userId,
      },
    })

    if (!connection || !connection.tokens) {
      throw new NoTokensError(serviceName)
    }

    return connection
  }

  /**
   * Parse and validate connection tokens
   * 
   * @param connection - The connection object containing tokens
   * @returns Object containing the access token
   * @throws Error if tokens are invalid or missing
   */
  private parseConnectionTokens(connection: { tokens: string | null }): { accessToken: string } {
    if (!connection.tokens) {
      throw new Error('No tokens available')
    }
    
    try {
      const tokenData = JSON.parse(connection.tokens) as { 
        access_token: string
        refresh_token?: string
        expiry_date?: number
      }
      
      if (!tokenData.access_token) {
        throw new Error('Access token is missing from stored tokens')
      }
      
      return { accessToken: tokenData.access_token }
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error('Invalid JSON format in stored tokens')
      }
      if (error instanceof Error) {
        throw error
      }
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
      const validation = await validateYouTubeOAuth(userId)
      
      if (!validation) {
        return {
          playlists: [],
          hasConnection: false,
          service
        }
      }

      // Get all playlists from the service API
      // For YouTube, we need the original structure for the discovery page
      let allPlaylists: YouTubePlaylist[] = []
      
      if (serviceName === YOUTUBE_SERVICE.NAME) {
        // Use YouTube service directly to get original structure
        const { createYouTubeService } = await import('./youtube.server')
        const youtubeService = createYouTubeService()
        const response: YouTubePlaylistListResponse = await youtubeService.getUserPlaylists(validation.tokenData.accessToken)
        allPlaylists = response.items || []
      } else {
        // For other services, use the common interface
        const musicService = createMusicService(serviceName)
        const playlistsResponse = await musicService.getUserPlaylists(validation.tokenData.accessToken)
        // Cast to YouTubePlaylist[] for now - in the future, we should create a generic Playlist type
        allPlaylists = playlistsResponse.items as unknown as YouTubePlaylist[] || []
      }

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

      const syncedPlaylistMap = new Map<string, string>(
        syncedPlaylists.map(p => [p.externalId, p.id])
      )

      // Combine API playlists with sync status and internal id
      const playlistsWithStatus: PlaylistWithSyncStatus[] = allPlaylists.map((playlist) => ({
        ...playlist,
        isSynced: syncedPlaylistMap.has(playlist.id),
        playlistInternalId: syncedPlaylistMap.get(playlist.id) || null,
      }))

      return {
        playlists: playlistsWithStatus,
        hasConnection: true,
        service
      }
    } catch (error) {
      console.error('Error getting playlists with sync status:', error)
      if (error instanceof ServiceNotFoundError || error instanceof NoTokensError) {
        throw error
      }
      throw new Error(`Failed to get playlists for service ${serviceName}`)
    }
  }

  /**
   * Add playlist to sync (includes fetching tracks)
   */
  async addPlaylistToSync(serviceName: string, externalPlaylistId: string, userId: string) {
    try {
      const service = await this.getServiceByName(serviceName)
      const connection = await this.getUserConnection(serviceName, userId)
      const tokenData = this.parseConnectionTokens(connection)
      const musicService = createMusicService(serviceName)

      // Get playlist details from API
      const playlistData = await musicService.getPlaylist(externalPlaylistId, tokenData.accessToken)
      
      // Get playlist items (tracks)
      const playlistItems = await musicService.getPlaylistItems(externalPlaylistId, tokenData.accessToken)

      // Create or update playlist in database
      const playlist = await prisma.servicePlaylist.upsert({
        where: {
          serviceId_externalId: {
            serviceId: service.id,
            externalId: externalPlaylistId
          }
        },
        update: {
          title: playlistData.snippet.title,
          description: playlistData.snippet.description || null,
          thumbnailUrl: getBestThumbnailUrl(playlistData.snippet.thumbnails),
          channelId: playlistData.snippet.channelId,
          channelTitle: playlistData.snippet.channelTitle,
          publishedAt: new Date(playlistData.snippet.publishedAt),
          itemCount: playlistData.contentDetails.itemCount,
          lastSyncedAt: new Date(),
          isActive: true
        },
        create: {
          serviceId: service.id,
          externalId: externalPlaylistId,
          title: playlistData.snippet.title,
          description: playlistData.snippet.description || null,
          thumbnailUrl: getBestThumbnailUrl(playlistData.snippet.thumbnails),
          channelId: playlistData.snippet.channelId,
          channelTitle: playlistData.snippet.channelTitle,
          publishedAt: new Date(playlistData.snippet.publishedAt),
          itemCount: playlistData.contentDetails.itemCount,
          ownerId: userId,
          lastSyncedAt: new Date(),
          isActive: true
        }
      })

      // Process tracks in a transaction for better performance and consistency
      const tracksAdded = await prisma.$transaction(async (tx) => {
        let processedTracks = 0
        
        for (let i = 0; i < playlistItems.length; i++) {
          const item = playlistItems[i]
          
          if (!item) continue
          
          try {
            // Create or update track
            const track = await tx.track.upsert({
              where: {
                serviceId_serviceProviderId: {
                  serviceId: service.id,
                  serviceProviderId: item.contentDetails.videoId
                }
              },
              update: {
                title: item.snippet.title,
                artist: item.snippet.videoOwnerChannelTitle || item.snippet.channelTitle,
                thumbnailUrl: getBestThumbnailUrl(item.snippet.thumbnails),
                serviceUrl: buildYouTubeUrl(item.contentDetails.videoId),
                updatedAt: new Date()
              },
              create: {
                serviceId: service.id,
                serviceProviderId: item.contentDetails.videoId,
                title: item.snippet.title,
                artist: item.snippet.videoOwnerChannelTitle || item.snippet.channelTitle,
                thumbnailUrl: getBestThumbnailUrl(item.snippet.thumbnails),
                serviceUrl: `https://youtube.com/watch?v=${item.contentDetails.videoId}`
              }
            })

            // Create or update synchronised playlist entry
            await tx.servicePlaylistTrack.upsert({
              where: {
                playlistId_trackId: {
                  playlistId: playlist.id,
                  trackId: track.id
                }
              },
              update: {
                position: i + 1
              },
              create: {
                playlistId: playlist.id,
                trackId: track.id,
                position: i + 1
              }
            })

            processedTracks++
          } catch (error) {
            console.error(`Error processing track ${item.contentDetails.videoId}:`, error)
            // Continue with other tracks
          }
        }
        
        return processedTracks
      })

      return {
        success: true,
        playlist,
        tracksAdded,
        message: `Successfully synced playlist with ${tracksAdded} tracks`
      }
    } catch (error) {
      console.error('Error adding playlist to sync:', error)
      if (error instanceof ServiceNotFoundError || error instanceof NoTokensError) {
        throw error
      }
      throw new Error(`Failed to add playlist ${externalPlaylistId} to sync`)
    }
  }

  /**
   * Remove playlist from sync (hard delete)
   */
  async removePlaylistFromSync(playlistId: string, userId: string) {
    try {
      let playlist = await prisma.servicePlaylist.findFirst({
        where: {
          id: playlistId,
          ownerId: userId,
        },
      })

      if (!playlist) {
        throw new PlaylistNotFoundError(playlistId)
      }

      // Delete the playlist
      await prisma.servicePlaylist.delete({
        where: {
          id: playlist.id
        }
      })

      return {
        success: true,
        message: 'Playlist removed from sync successfully'
      }
    } catch (error) {
      console.error('Error removing playlist from sync:', error)
      if (error instanceof PlaylistNotFoundError) {
        throw error
      }
      throw new Error(`Failed to remove playlist ${playlistId} from sync`)
    }
  }

  /**
   * Get synced playlists for a service
   */
  async getSyncedPlaylists(serviceName: string, userId: string) {
    try {
      const service = await this.getServiceByName(serviceName)

      const playlists = await prisma.servicePlaylist.findMany({
        where: {
          serviceId: service.id,
          ownerId: userId,
          isActive: true
        },
        orderBy: {
          updatedAt: 'desc'
        }
      })

      return playlists
    } catch (error) {
      console.error('Error getting synced playlists:', error)
      if (error instanceof ServiceNotFoundError) {
        throw error
      }
      throw new Error(`Failed to get synced playlists for service ${serviceName}`)
    }
  }

  /**
   * Get playlist tracks with user library status
   */
  async getPlaylistTracksWithUserStatus(playlistId: string, userId: string) {
    try {
      const playlist = await prisma.servicePlaylist.findFirst({
        where: {
          id: playlistId,
          ownerId: userId,
        },
        include: {
          service: true
        }
      })

      if (!playlist) {
        throw new PlaylistNotFoundError(playlistId)
      }

      const servicePlaylistTracks = await prisma.servicePlaylistTrack.findMany({
        where: { playlistId },
        include: {
          track: {
            include: {
              userTracks: {
                where: { userId }
              }
            }
          }
        },
        orderBy: { position: 'asc' }
      })

      // Transform to include user library status
      const tracksWithStatus = servicePlaylistTracks.map(st => ({
        ...st.track,
        position: st.position,
        isInUserLibrary: st.track.userTracks.length > 0 && st.track.userTracks[0]?.isActive === true,
        userTrack: st.track.userTracks[0] || null
      }))

      return {
        playlist,
        tracks: tracksWithStatus
      }
    } catch (error) {
      console.error('Error getting playlist tracks with user status:', error)
      if (error instanceof PlaylistNotFoundError) {
        throw error
      }
      throw new Error(`Failed to get tracks for playlist ${playlistId}`)
    }
  }

  /**
   * Re-sync playlist
   */
  async resyncPlaylist(playlistId: string, userId: string) {
    try {
      const playlist = await prisma.servicePlaylist.findFirst({
        where: {
          id: playlistId,
          ownerId: userId,
        },
        include: {
          service: true
        }
      })

      if (!playlist) {
        throw new PlaylistNotFoundError(playlistId)
      }

      // Use the existing addPlaylistToSync method to re-sync
      return this.addPlaylistToSync(playlist.service.name, playlist.externalId, userId)
    } catch (error) {
      console.error('Error resyncing playlist:', error)
      if (error instanceof PlaylistNotFoundError) {
        throw error
      }
      throw new Error(`Failed to resync playlist ${playlistId}`)
    }
  }

  /**
   * Add track to user's library
   */
  async addTrackToUserLibrary(trackId: string, userId: string) {
    try {
      // Check if track was previously soft deleted
      const existingUserTrack = await prisma.userTrack.findUnique({
        where: {
          userId_trackId: {
            userId,
            trackId
          }
        }
      })

      if (existingUserTrack) {
        // Restore soft deleted track
        return prisma.userTrack.update({
          where: { id: existingUserTrack.id },
          data: {
            isActive: true,
            deletedAt: null,
            updatedAt: new Date()
          }
        })
      } else {
        // Create new user track
        return prisma.userTrack.create({
          data: {
            userId,
            trackId,
            isActive: true
          }
        })
      }
    } catch (error) {
      console.error('Error adding track to user library:', error)
      throw new Error(`Failed to add track ${trackId} to user library`)
    }
  }

  /**
   * Remove track from user's library (soft delete)
   */
  async removeTrackFromUserLibrary(trackId: string, userId: string) {
    try {
      return prisma.userTrack.update({
        where: {
          userId_trackId: {
            userId,
            trackId
          }
        },
        data: {
          isActive: false,
          deletedAt: new Date(),
          updatedAt: new Date()
        }
      })
    } catch (error) {
      console.error('Error removing track from user library:', error)
      throw new Error(`Failed to remove track ${trackId} from user library`)
    }
  }
}

/**
 * Factory function to create a ServicePlaylistService instance
 * 
 * @returns ServicePlaylistService instance
 */
export function createServicePlaylistService(): ServicePlaylistService {
	return new ServicePlaylistService()
}
