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
import { getOrCreateArtistTx } from '#app/utils/artist-management.server'
import { downloadExternalImage, findOrCreateCoverImage } from '#app/utils/cover-management.server'
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
  trackData: Omit<ReturnType<typeof transformYouTubePlaylistItemToTrack>, 'thumbnailUrl' | 'service' | 'externalId'> & { serviceId: string; externalId: string; coverImageId?: string | null }
  position: number
  item: NewYouTubePlaylistItem
}


/**
 * Track information for sync reporting
 */
interface SyncTrackInfo {
  id: string
  title: string
  externalId?: string
}

/**
 * Pending match for deleted videos that need user confirmation
 */
interface PendingMatch {
  deletedVideo: {
    position: number
    itemId: string | undefined
    title: string | undefined
    snippet: NewYouTubePlaylistItem['snippet'] | undefined
  }
  candidateTracks: Array<{
    id: string
    title: string
    artist: string
    externalId: string | null
    position: number
    isDeleted: boolean
  }>
}

/**
 * Result from processing tracks in batches
 */
interface ProcessTracksResult {
  processedCount: number
  deletedTracks: SyncTrackInfo[]
  processedExternalIds: Set<string>
  processedTrackIds: Set<string>
  pendingMatches: PendingMatch[]
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
   * Find orphaned tracks (tracks in playlist but not in current sync)
   * These are candidates for matching with deleted videos
   * 
   * @param playlistId - The playlist ID
   * @param processedExternalIds - Set of external IDs that were processed in current sync
   * @param processedTrackIds - Set of track IDs that were processed in current sync
   * @param pendingMatches - Array of existing pending matches to avoid duplicate suggestions
   * @param tx - Prisma transaction instance
   * @returns Array of orphaned tracks with metadata
   */
  private async findOrphanedTracks(
    playlistId: string,
    processedExternalIds: Set<string>,
    processedTrackIds: Set<string>,
    pendingMatches: PendingMatch[],
    tx: any
  ): Promise<Array<{
    id: string
    title: string
    artist: string
    externalId: string | null
    position: number
    isDeleted: boolean
  }>> {
    // Get all tracks in the playlist
    const allPlaylistTracks = await tx.servicePlaylistTrack.findMany({
      where: {
        playlistId: playlistId
      },
      include: {
        track: {
          select: {
            id: true,
            title: true,
            artist: {
              select: {
                id: true,
                name: true
              }
            },
            externalId: true
          }
        }
      },
      orderBy: {
        position: 'asc'
      }
    })

    // Get track IDs already claimed in pending matches
    const claimedTrackIds = new Set<string>()
    for (const match of pendingMatches) {
      for (const candidate of match.candidateTracks) {
        claimedTrackIds.add(candidate.id)
      }
    }

    // Filter orphaned tracks:
    // 1. Not in processedExternalIds or processedTrackIds (not in current sync)
    // 2. Not already deleted (isDeleted === false) - Edge Case 9
    // 3. Not already claimed in pending matches
    const orphanedTracks = allPlaylistTracks
      .filter((playlistTrack: { track: { externalId: string | null; id: string }; isDeleted: boolean }) => {
        const externalId = playlistTrack.track.externalId
        const trackId = playlistTrack.track.id
        
        // Skip if already processed in current sync
        if (externalId && processedExternalIds.has(externalId)) return false
        if (processedTrackIds.has(trackId)) return false
        
        // Skip if already deleted - Edge Case 9
        if (playlistTrack.isDeleted) return false
        
        // Skip if already claimed in pending matches
        if (claimedTrackIds.has(trackId)) return false
        
        return true
      })
      .map((playlistTrack: { track: { id: string; title: string; artist: { id: string; name: string } | null; externalId: string | null }; position: number; isDeleted: boolean }) => ({
        id: playlistTrack.track.id,
        title: playlistTrack.track.title,
        artist: playlistTrack.track.artist?.name || 'Unknown Artist',
        externalId: playlistTrack.track.externalId,
        position: playlistTrack.position,
        isDeleted: playlistTrack.isDeleted
      }))

    return orphanedTracks
  }

  /**
   * Pre-download cover images for playlist items
   * Downloads images in parallel to speed up the process
   * 
   * @param playlistItems - Array of playlist items to download images for
   * @returns Map of externalId to image buffer
   */
  private async preDownloadImages(
    playlistItems: NewYouTubePlaylistItem[]
  ): Promise<Map<string, Buffer>> {
    const imageMap = new Map<string, Buffer>()
    
    // Download images in parallel
    const downloadPromises = playlistItems.map(async (item) => {
      // Use the same logic as processTracksInBatches to determine externalId
      let externalId = item.snippet?.resourceId?.videoId || ''
      const isDeleted = this.isDeletedYouTubeVideo(item)
      
      // For deleted videos, use item.id if available, otherwise skip (will be handled in processTracksInBatches)
      if (isDeleted && !externalId) {
        externalId = item.id || ''
      }
      
      if (!externalId) return
      
      const thumbnailUrl = item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || null
      if (!thumbnailUrl) return
      
      try {
        const imageBuffer = await downloadExternalImage(thumbnailUrl)
        if (imageBuffer) {
          imageMap.set(externalId, imageBuffer)
        }
      } catch (error) {
        console.warn(`Failed to download cover image for ${externalId}:`, error)
        // Continue without this image
      }
    })
    
    await Promise.all(downloadPromises)
    return imageMap
  }

  /**
   * Process tracks in batches for better performance
   * Images should be pre-downloaded and passed in to avoid transaction timeouts
   * 
   * @param playlistItems - Array of playlist items to process
   * @param serviceId - The service ID
   * @param playlistId - The playlist ID
   * @param tx - Prisma transaction instance
   * @param preDownloadedImages - Map of externalId to pre-downloaded image buffers
   * @returns Result with processed count, deleted tracks, and processed external IDs
   */
  private async processTracksInBatches(
    playlistItems: NewYouTubePlaylistItem[],
    serviceId: string,
    playlistId: string,
    tx: any,
    globalStartPosition: number = 0,
    accumulatedProcessedExternalIds?: Set<string>,
    accumulatedProcessedTrackIds?: Set<string>
  ): Promise<ProcessTracksResult> {
    let processedTracks = 0
    const batchSize = 50
    const deletedTracks: SyncTrackInfo[] = []
    // Merge accumulated sets with new sets to track all processed items across batches
    const processedExternalIds = new Set<string>(accumulatedProcessedExternalIds || [])
    const processedTrackIds = new Set<string>(accumulatedProcessedTrackIds || [])
    const pendingMatches: PendingMatch[] = []
    
    for (let batchStart = 0; batchStart < playlistItems.length; batchStart += batchSize) {
      const batch = playlistItems.slice(batchStart, batchStart + batchSize)
      
      // Prepare batch data
      const trackDataBatch: TrackDataBatch[] = []
      // Collect deleted videos without matches for second pass (orphaned track detection)
      const deletedVideosWithoutMatch: Array<{
        item: NewYouTubePlaylistItem
        position: number
        externalId: string
      }> = []
      
      // FIRST PASS: Process all items in the batch
      for (let i = 0; i < batch.length; i++) {
        const item = batch[i] as NewYouTubePlaylistItem
        if (!item) continue
        
        // Use videoId if available, otherwise use playlist item ID or generate unique identifier
        // This prevents multiple deleted videos from collapsing into a single track record
        let externalId = item.snippet?.resourceId?.videoId || ''
        const position = globalStartPosition + batchStart + i + 1
        const isDeleted = this.isDeletedYouTubeVideo(item)
        
        // Try to find existing track by stable identifiers
        let existingTrack: { id: string; title: string; artistId: string; coverImageId: string | null; externalId: string | null } | null = null
        
        // First, try matching by playlist item ID (for deleted videos)
        if (isDeleted && item.id) {
          // Try to find a track with this playlist item ID as externalId
          existingTrack = await tx.track.findUnique({
            where: {
              serviceId_externalId: {
                serviceId,
                externalId: item.id
              }
            },
            select: {
              id: true,
              title: true,
              artistId: true,
              coverImageId: true,
              externalId: true
            }
          })
        }
        
        // If not found, try matching by videoId (externalId)
        if (!existingTrack && externalId) {
          existingTrack = await tx.track.findUnique({
            where: {
              serviceId_externalId: {
                serviceId,
                externalId
              }
            },
            select: {
              id: true,
              title: true,
              artistId: true,
              coverImageId: true,
              externalId: true
            }
          })
        }
        
        // For deleted videos without a match, defer orphaned track detection to second pass
        // This ensures all tracks in the current batch are processed first
        if (isDeleted && !existingTrack) {
          // Generate a temporary externalId for tracking
          if (item.id) {
            externalId = item.id
          } else {
            externalId = `pending-${playlistId}-${item.id || position}`
          }
          
          // Store for second pass processing
          deletedVideosWithoutMatch.push({
            item,
            position,
            externalId
          })
          
          // Mark externalId as processed to prevent it from being marked as "removed"
          // This ensures pending deleted videos aren't deleted before user confirmation
          processedExternalIds.add(externalId)
          
          // Skip creating track immediately - wait for user confirmation
          continue
        }
        
        // Generate externalId for deleted videos if not already set
        if (isDeleted && !externalId) {
          if (item.id) {
            externalId = item.id
          } else {
            externalId = `deleted-${playlistId}-${position}`
          }
        }
        
        // Skip tracks without a valid externalId (can't use unique constraint with empty string)
        // Deleted videos should have been handled above with generated IDs
        if (!externalId || externalId.trim() === '') {
          console.warn(`Skipping track without externalId at position ${position}: ${item.snippet?.title || 'Unknown'}`)
          continue
        }
        
        try {
          // Get or create artist
          const artistName = item.snippet?.videoOwnerChannelTitle || item.snippet?.channelTitle || 'Unknown Artist'
          const artistRecord = await getOrCreateArtistTx(tx, artistName)
          
          // Determine if we should preserve existing track data
          const preserveData = this.shouldPreserveTrackData(existingTrack, item)
          
          // Skip image processing during sync - will be processed in background
          // Preserve existing coverImageId if available, otherwise set to null
          const coverImageId: string | null = preserveData && existingTrack?.coverImageId 
            ? existingTrack.coverImageId 
            : null

          let trackData: Omit<ReturnType<typeof transformYouTubePlaylistItemToTrack>, 'thumbnailUrl' | 'service' | 'externalId'> & { serviceId: string; externalId: string; coverImageId?: string | null }
          if (preserveData && existingTrack) {
            // Preserve existing data, only update non-critical fields
            // Use existing artistId if preserving data
            const transformed = transformYouTubePlaylistItemToTrack(item, serviceId, existingTrack.artistId)
            const { thumbnailUrl: _, service: __, externalId: ___, ...rest } = transformed
            trackData = {
              ...rest,
              serviceId, // Use serviceId directly instead of service relation
              title: existingTrack.title,
              artistId: existingTrack.artistId,
              coverImageId: coverImageId || existingTrack.coverImageId || null,
              externalId, // Use the generated/actual externalId (explicitly set, not from transformation)
            }
          } else {
            const transformed = transformYouTubePlaylistItemToTrack(item, serviceId, artistRecord.id)
            const { thumbnailUrl: _, service: __, externalId: ___, ...rest } = transformed
            trackData = {
              ...rest,
              serviceId, // Use serviceId directly instead of service relation
              coverImageId,
              externalId, // Override with the generated/actual externalId (explicitly set, not from transformation)
            }
          }
          
          trackDataBatch.push({
            serviceId,
            externalId,
            trackData,
            position, // Use the calculated position that includes globalStartPosition
            item
          })
          
          // Mark as processed after successful preparation
          // Always add externalId, even for deleted videos with generated IDs
          processedExternalIds.add(externalId)
        } catch (error) {
          console.error(`Error preparing track ${item.snippet?.resourceId?.videoId || 'unknown'}:`, error)
          // externalId is NOT added to processedExternalIds on error, so it will be removed if it exists
        }
      }
      
      // Batch upsert tracks
      const trackPromises = trackDataBatch
        .filter(({ serviceId, externalId }) => {
          // Filter out any entries with invalid IDs (shouldn't happen, but safety check)
          if (!serviceId || !externalId || externalId.trim() === '') {
            console.warn(`Skipping track upsert with invalid IDs: serviceId=${serviceId}, externalId=${externalId}`)
            return false
          }
          return true
        })
        .map(async ({ serviceId, externalId, trackData }) => {
          // Final validation: ensure both serviceId and externalId are non-empty strings
          // SQLite unique indexes on nullable columns require non-null, non-empty values for upsert
          if (!serviceId || !externalId || serviceId.trim() === '' || externalId.trim() === '') {
            console.error(`Invalid upsert parameters: serviceId="${serviceId}", externalId="${externalId}"`)
            throw new Error(`Cannot upsert track: serviceId and externalId must be non-empty strings. Got serviceId="${serviceId}", externalId="${externalId}"`)
          }
          
          // Ensure trackData has the correct serviceId and externalId for the create clause
          // This is critical for SQLite unique constraint matching
          const createData = {
            ...trackData,
            serviceId, // Explicitly set to ensure it matches the where clause
            externalId, // Explicitly set to ensure it matches the where clause
          }
          
          // Validate createData has required fields
          if (!createData.serviceId || !createData.externalId || createData.serviceId.trim() === '' || createData.externalId.trim() === '') {
            console.error(`Invalid createData: serviceId="${createData.serviceId}", externalId="${createData.externalId}"`)
            throw new Error(`Cannot create track: createData must have non-empty serviceId and externalId`)
          }
          
          return tx.track.upsert({
            where: {
              serviceId_externalId: {
                serviceId,
                externalId
              }
            },
            update: {
              ...trackData,
              serviceId, // Ensure update also has correct values
              externalId, // Ensure update also has correct values
              updatedAt: new Date()
            },
            create: createData
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
        
        // Get thumbnailUrl from YouTube API response
        const thumbnailUrl = item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || null
        
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
            deletedAt: shouldSetDeletedAt ? new Date() : (isDeleted ? existingPlaylistTrack?.deletedAt : null),
            thumbnailUrl // Store thumbnail URL for background processing
          },
          create: {
            playlistId: playlistId,
            trackId: track.id,
            position: trackData.position,
            isDeleted,
            deletedAt: isDeleted ? new Date() : null,
            thumbnailUrl // Store thumbnail URL for background processing
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
      })
      
      // Await all promises first, then filter out null results
      const playlistTrackResults = await Promise.all(playlistTrackPromises)
      const successfulResults = playlistTrackResults.filter((result): result is NonNullable<typeof result> => result !== null)
      
      // Track all successfully processed trackIds for removal detection
      for (const result of successfulResults) {
        processedTrackIds.add(result.trackId)
      }
      
      // Count only successfully processed tracks
      processedTracks += successfulResults.length
      
      // SECOND PASS: Find orphaned tracks for deleted videos without matches
      // This happens AFTER all tracks in the current batch are processed and added to processedTrackIds
      // This prevents false positives where tracks in the current batch are incorrectly marked as orphaned
      for (const deletedVideo of deletedVideosWithoutMatch) {
        // Find orphaned tracks (tracks in playlist but not in current sync)
        // At this point, processedTrackIds includes all tracks from previous batches AND the current batch
        const orphanedTracks = await this.findOrphanedTracks(
          playlistId,
          processedExternalIds,
          processedTrackIds,
          pendingMatches,
          tx
        )
        
        // Add to pendingMatches for user confirmation
        pendingMatches.push({
          deletedVideo: {
            position: deletedVideo.position,
            itemId: deletedVideo.item.id,
            title: deletedVideo.item.snippet?.title,
            snippet: deletedVideo.item.snippet
          },
          candidateTracks: orphanedTracks
        })
      }
    }
    
    return {
      processedCount: processedTracks,
      deletedTracks,
      processedExternalIds,
      processedTrackIds,
      pendingMatches
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
      // getUserPlaylists now returns all playlists across all pages (handles pagination internally)
      const allPlaylists = await youtubeService.getUserPlaylists(validation.tokenData.access_token)

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
  async addPlaylistToSync(serviceName: string, externalPlaylistId: string, userId: string): Promise<{
    success: boolean
    playlistId?: string
    tracksAdded?: number
    totalTracks?: number
    pendingMatches?: PendingMatch[]
    error?: string
    message?: string
  }> {
    try {
      const service = await this.getServiceByName(serviceName)
      const connection = await this.getUserConnection(serviceName, userId)
      const tokenData = this.parseConnectionTokens(connection)

      // For now, we only support YouTube - other services will be added later
      if (serviceName !== YOUTUBE_SERVICE.NAME) {
        return {
          success: false,
          error: `Service ${serviceName} is not yet supported`,
          message: `Service ${serviceName} is not yet supported`
        }
      }

      // Get playlist details and items using YouTube service directly
      const youtubeService = createYouTubeService()
      const [youtubePlaylist, playlistItems] = await Promise.all([
        youtubeService.getPlaylist(externalPlaylistId, tokenData.access_token),
        youtubeService.getPlaylistItems(externalPlaylistId, tokenData.access_token)
      ])

      // getPlaylist and getPlaylistItems already validate and return validated data
      // Transform playlist data using new type-safe architecture
      const playlistDataRaw = transformYouTubePlaylistToServicePlaylist(
        youtubePlaylist,
        service.id,
        userId
      )

      // Extract service and owner relations for upsert (Prisma requires IDs directly, not relations)
      const { service: _, owner: __, ...playlistData } = playlistDataRaw

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
          serviceId: service.id, // Use serviceId directly for upsert
          ownerId: userId, // Use ownerId directly for upsert
          lastSyncedAt: new Date(),
          isActive: true
        },
        create: {
          ...playlistData,
          serviceId: service.id, // Use serviceId directly for upsert
          ownerId: userId, // Use ownerId directly for upsert
          lastSyncedAt: new Date(),
          isActive: true
        }
      })

      // Process tracks in smaller transaction batches to avoid timeouts
      // For large playlists, process 10-15 tracks per transaction
      const TRANSACTION_BATCH_SIZE = 15
      const totalItems = playlistItems.length
      let accumulatedResult: ProcessTracksResult = {
        processedCount: 0,
        deletedTracks: [],
        processedExternalIds: new Set<string>(),
        processedTrackIds: new Set<string>(),
        pendingMatches: []
      }

      // Process tracks in smaller transaction batches
      for (let batchStart = 0; batchStart < totalItems; batchStart += TRANSACTION_BATCH_SIZE) {
        const batchItems = playlistItems.slice(batchStart, batchStart + TRANSACTION_BATCH_SIZE)
        
        try {
          const batchResult = await prisma.$transaction(async (tx) => {
            return this.processTracksInBatches(
              batchItems, 
              service.id, 
              playlist.id, 
              tx, 
              batchStart,
              accumulatedResult.processedExternalIds,
              accumulatedResult.processedTrackIds
            )
          }, {
            timeout: 30000, // 30 seconds per batch
          })

          // Accumulate results
          accumulatedResult.processedCount += batchResult.processedCount
          accumulatedResult.deletedTracks.push(...batchResult.deletedTracks)
          batchResult.processedExternalIds.forEach(id => accumulatedResult.processedExternalIds.add(id))
          batchResult.processedTrackIds.forEach(id => accumulatedResult.processedTrackIds.add(id))
          accumulatedResult.pendingMatches.push(...batchResult.pendingMatches)
        } catch (batchError) {
          console.error(`Error processing batch ${batchStart}-${batchStart + TRANSACTION_BATCH_SIZE}:`, batchError)
          // Check for transaction timeout errors
          if (batchError instanceof Error && (batchError.message.includes('expired transaction') || batchError.message.includes('timeout'))) {
            return {
              success: false,
              error: 'Transaction timeout',
              message: 'The playlist sync took too long and timed out. This may happen with very large playlists. Please try again or contact support if the issue persists.'
            }
          }
          // Re-throw other errors to be caught by outer try-catch
          throw batchError
        }
      }

      const processResult = accumulatedResult

      // Trigger background image processing (fire-and-forget)
      // Fetch ServicePlaylistTrack IDs for tracks that were just synced
      const playlistTrackIds = await prisma.servicePlaylistTrack.findMany({
        where: {
          playlistId: playlist.id,
          thumbnailUrl: { not: null }
        },
        select: { id: true }
      }).then(records => records.map(r => r.id))

      if (playlistTrackIds.length > 0) {
        // Fire and forget - don't await, process on server in background
        void this.processPlaylistTrackImagesAsync(playlistTrackIds).catch(error => {
          console.error('Error processing track images in background:', error)
        })
      }

      return {
        success: true,
        playlistId: playlist.id,
        tracksAdded: processResult.processedCount,
        totalTracks: playlistItems.length,
        pendingMatches: processResult.pendingMatches
      }
    } catch (error) {
      console.error('Error adding playlist to sync:', error)
      const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred'
      return {
        success: false,
        error: errorMessage,
        message: `Failed to sync playlist: ${errorMessage}`
      }
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
            artist: {
              select: {
                id: true,
                name: true
              }
            },
            coverImage: {
              select: {
                objectKey: true
              }
            },
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
        artist: pt.track.artist || { id: '', name: 'Unknown Artist' },
        position: pt.position,
        isDeleted: pt.isDeleted,
        deletedAt: pt.deletedAt,
        thumbnailUrl: pt.thumbnailUrl // Include thumbnailUrl from ServicePlaylistTrack
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
    
    // Transform to type-safe frontend format
    const playlist: PlaylistWithTracks = {
      ...result.playlist,
      tracks: []
    }
    
    const tracks: TrackWithUserStatus[] = result.tracks.map(track => ({
      ...track,
      artist: track.artist || { id: '', name: 'Unknown Artist' }, // Ensure artist is always an object
      isDeleted: track.isDeleted || false,
      deletedAt: track.deletedAt || null,
      coverImage: track.coverImage ? {
        objectKey: track.coverImage.objectKey
      } : null,
      thumbnailUrl: (track as any).thumbnailUrl || null, // Include thumbnailUrl from ServicePlaylistTrack
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
    pendingMatches: PendingMatch[]
    message?: string
    error?: string
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
          removedTracks: [],
          pendingMatches: [],
          message: 'Playlist not found. It may have been removed or you may not have access to it.',
          error: 'Playlist not found. It may have been removed or you may not have access to it.'
        }
      }
      
      // Use the existing sync method
      const result = await this.syncPlaylistTracks(playlist.service.name, playlistId, userId)
      // syncPlaylistTracks already includes a message field
      return result
    } catch (error) {
      console.error('Error resyncing playlist:', error)
      const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred'
      return { 
        success: false, 
        tracksAdded: 0, 
        totalTracks: 0,
        deletedTracks: [],
        removedTracks: [],
        pendingMatches: [],
        message: errorMessage,
        error: errorMessage
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
    pendingMatches: PendingMatch[]
    message: string
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
    let playlistItems: Awaited<ReturnType<typeof youtubeService.getPlaylistItems>>
    try {
      playlistItems = await youtubeService.getPlaylistItems(playlist.externalId, tokenData.access_token)
    } catch (error) {
      // Re-throw with more context if it's a known error type
      if (error instanceof Error) {
        throw error
      }
      throw new Error('Failed to fetch playlist items from YouTube')
    }

    // Process tracks in smaller transaction batches to avoid timeouts
    // For large playlists, process 10-15 tracks per transaction
    const TRANSACTION_BATCH_SIZE = 15
    const totalItems = playlistItems.length
    let accumulatedResult: ProcessTracksResult = {
      processedCount: 0,
      deletedTracks: [],
      processedExternalIds: new Set<string>(),
      processedTrackIds: new Set<string>(),
      pendingMatches: []
    }

    // Process tracks in smaller transaction batches
    for (let batchStart = 0; batchStart < totalItems; batchStart += TRANSACTION_BATCH_SIZE) {
      const batchItems = playlistItems.slice(batchStart, batchStart + TRANSACTION_BATCH_SIZE)
      
      try {
        const batchResult = await prisma.$transaction(async (tx) => {
          return this.processTracksInBatches(
            batchItems, 
            service.id, 
            playlist.id, 
            tx, 
            batchStart,
            accumulatedResult.processedExternalIds,
            accumulatedResult.processedTrackIds
          )
        }, {
          timeout: 30000, // 30 seconds per batch
        })

        // Accumulate results
        accumulatedResult.processedCount += batchResult.processedCount
        accumulatedResult.deletedTracks.push(...batchResult.deletedTracks)
        batchResult.processedExternalIds.forEach(id => accumulatedResult.processedExternalIds.add(id))
        batchResult.processedTrackIds.forEach(id => accumulatedResult.processedTrackIds.add(id))
        accumulatedResult.pendingMatches.push(...batchResult.pendingMatches)
      } catch (batchError) {
        console.error(`Error processing batch ${batchStart}-${batchStart + TRANSACTION_BATCH_SIZE}:`, batchError)
        // Check for transaction timeout errors
        if (batchError instanceof Error && (batchError.message.includes('expired transaction') || batchError.message.includes('timeout'))) {
          return {
            success: false,
            tracksAdded: accumulatedResult.processedCount,
            totalTracks: playlistItems.length,
            deletedTracks: accumulatedResult.deletedTracks,
            removedTracks: [],
            pendingMatches: accumulatedResult.pendingMatches,
            message: 'The playlist sync took too long and timed out. Some tracks may have been synced. Please try again.'
          }
        }
        // Re-throw other errors to be caught by outer try-catch
        throw batchError
      }
    }

    const processResult = accumulatedResult

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

    // Get track IDs that are candidates in pending matches (don't remove these yet)
    const candidateTrackIds = new Set<string>()
    for (const match of processResult.pendingMatches) {
      for (const candidate of match.candidateTracks) {
        candidateTrackIds.add(candidate.id)
      }
    }

    const removedTracks: SyncTrackInfo[] = []
    const tracksToRemove: string[] = []

    for (const playlistTrack of existingPlaylistTracks) {
      const externalId = playlistTrack.track.externalId
      const trackId = playlistTrack.track.id
      
      // Don't remove tracks that are candidates in pending matches
      if (candidateTrackIds.has(trackId)) {
        continue
      }
      
      // Determine if track should be removed:
      // 1. If externalId exists and is not in processedExternalIds → remove
      // 2. If externalId is null/empty and trackId is not in processedTrackIds → remove
      const shouldRemove = externalId
        ? !processResult.processedExternalIds.has(externalId)
        : !processResult.processedTrackIds.has(trackId)
      
      if (shouldRemove) {
        // This track is no longer in the YouTube playlist
        removedTracks.push({
          id: trackId,
          title: playlistTrack.track.title,
          ...(externalId && { externalId })
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

    // Trigger background image processing (fire-and-forget)
    // Fetch ServicePlaylistTrack IDs for tracks that were just synced
    const playlistTrackIds = await prisma.servicePlaylistTrack.findMany({
      where: {
        playlistId: playlist.id,
        thumbnailUrl: { not: null }
      },
      select: { id: true }
    }).then(records => records.map(r => r.id))

    if (playlistTrackIds.length > 0) {
      // Fire and forget - don't await, process on server in background
      void this.processPlaylistTrackImagesAsync(playlistTrackIds).catch(error => {
        console.error('Error processing track images in background:', error)
      })
    }

    return {
      success: true,
      tracksAdded: processResult.processedCount,
      totalTracks: playlistItems.length,
      deletedTracks: processResult.deletedTracks,
      removedTracks,
      pendingMatches: processResult.pendingMatches,
      message: `Playlist synced successfully. ${processResult.processedCount} tracks processed.`
    }
  }

  /**
   * Confirm deleted video matches - process user selections for pending matches
   * 
   * @param playlistId - The playlist ID
   * @param matches - Array of user selections: { deletedItemId, selectedTrackId, position, action }
   * @param userId - The user ID
   * @returns Result with success count and any errors
   */
  async confirmDeletedVideoMatches(
    playlistId: string,
    matches: Array<{
      deletedItemId: string | undefined
      selectedTrackId: string | null
      position: number
      action: 'match' | 'new' | 'skip'
    }>,
    userId: string
  ): Promise<{
    success: boolean
    processedCount: number
    message: string
    error?: string
  }> {
    // Verify playlist ownership
    const playlist = await prisma.servicePlaylist.findFirst({
      where: {
        id: playlistId,
        ownerId: userId,
        isActive: true
      },
      include: { service: true }
    })

    if (!playlist) {
      return {
        success: false,
        processedCount: 0,
        message: 'Playlist not found or access denied',
        error: 'Playlist not found or access denied'
      }
    }

    if (!playlist.service) {
      return {
        success: false,
        processedCount: 0,
        message: 'Service not found for playlist',
        error: 'Service not found for playlist'
      }
    }

    const service = await this.getServiceByName(playlist.service.name)
    const { createId } = await import('@paralleldrive/cuid2')

    try {
      // Process all matches in a single transaction (Edge Case 10)
      const result = await prisma.$transaction(async (tx) => {
        let processedCount = 0

        for (const match of matches) {
          if (match.action === 'skip') {
            // Do nothing - skip this deleted video
            continue
          }

          if (match.action === 'new') {
            // Create new track with generated ID
            const newTrackId = createId()
            const externalId = match.deletedItemId || `deleted-${playlistId}-${match.position}`
            
            // Get or create artist
            const artistRecord = await getOrCreateArtistTx(tx, 'Unknown Artist')
            
            // Create track
            const track = await tx.track.create({
              data: {
                id: newTrackId,
                title: 'Deleted video',
                artistId: artistRecord.id,
                duration: null,
                externalId,
                serviceId: service.id,
                serviceUrl: null,
                releaseDate: null
              }
            })

            // Create ServicePlaylistTrack
            await tx.servicePlaylistTrack.create({
              data: {
                id: createId(),
                playlistId: playlistId,
                trackId: track.id,
                position: match.position,
                isDeleted: true,
                deletedAt: new Date()
              }
            })

            processedCount++
          } else if (match.action === 'match' && match.selectedTrackId) {
            // Match deleted video to existing track
            const track = await tx.track.findUnique({
              where: { id: match.selectedTrackId }
            })

            if (!track) {
              throw new Error(`Track not found: ${match.selectedTrackId}`)
            }

            // Check if ServicePlaylistTrack already exists
            const existingPlaylistTrack = await tx.servicePlaylistTrack.findUnique({
              where: {
                playlistId_trackId: {
                  playlistId: playlistId,
                  trackId: track.id
                }
              }
            })

            if (existingPlaylistTrack) {
              // Update existing record
              await tx.servicePlaylistTrack.update({
                where: {
                  playlistId_trackId: {
                    playlistId: playlistId,
                    trackId: track.id
                  }
                },
                data: {
                  position: match.position,
                  isDeleted: true,
                  deletedAt: existingPlaylistTrack.deletedAt || new Date()
                }
              })
            } else {
              // Create new ServicePlaylistTrack
              await tx.servicePlaylistTrack.create({
                data: {
                  id: createId(),
                  playlistId: playlistId,
                  trackId: track.id,
                  position: match.position,
                  isDeleted: true,
                  deletedAt: new Date()
                }
              })
            }

            processedCount++
          }
        }

        return { processedCount }
      })

      return {
        success: true,
        processedCount: result.processedCount,
        message: `Successfully processed ${result.processedCount} match(es).`
      }
    } catch (error) {
      console.error('Error confirming deleted video matches:', error)
      const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred'
      return {
        success: false,
        processedCount: 0,
        message: `Failed to process matches. No changes were made. Please try again.`,
        error: errorMessage
      }
    }
  }

  /**
   * Process images for playlist tracks in the background (server-side async)
   * This is called after sync completes to process images without blocking the response
   * 
   * @param playlistTrackIds - Array of ServicePlaylistTrack IDs to process images for
   */
  private async processPlaylistTrackImagesAsync(playlistTrackIds: string[]): Promise<void> {
    // Server-side background processing - runs after response is sent
    // Process images in batches with concurrency control
    await this.processPlaylistTrackImagesInBatches(playlistTrackIds)
  }

  /**
   * Process images in batches with concurrency control
   * 
   * @param playlistTrackIds - Array of ServicePlaylistTrack IDs to process
   */
  private async processPlaylistTrackImagesInBatches(playlistTrackIds: string[]): Promise<void> {
    const MAX_CONCURRENCY = 5
    
    // Fetch ServicePlaylistTrack records with thumbnailUrl and trackId
    const playlistTracks = await prisma.servicePlaylistTrack.findMany({
      where: {
        id: { in: playlistTrackIds },
        thumbnailUrl: { not: null }
      },
      include: {
        track: {
          select: {
            id: true,
            coverImageId: true
          }
        }
      }
    })

    // Filter out tracks that already have cover images
    const tracksToProcess = playlistTracks.filter(pt => 
      pt.thumbnailUrl && !pt.track.coverImageId
    )

    if (tracksToProcess.length === 0) {
      return
    }

    // Process images in parallel with concurrency limit
    for (let i = 0; i < tracksToProcess.length; i += MAX_CONCURRENCY) {
      const batch = tracksToProcess.slice(i, i + MAX_CONCURRENCY)
      
      await Promise.all(
        batch.map(async (playlistTrack) => {
          if (!playlistTrack.thumbnailUrl) return

          try {
            // Download image from thumbnailUrl
            const imageBuffer = await downloadExternalImage(playlistTrack.thumbnailUrl)
            if (!imageBuffer) {
              console.warn(`Failed to download image from ${playlistTrack.thumbnailUrl}`)
              return
            }

            // Process and create CoverImage
            const coverImage = await findOrCreateCoverImage({
              imageBuffer,
              trackId: playlistTrack.trackId,
            })

            // Update Track.coverImageId
            await prisma.track.update({
              where: { id: playlistTrack.trackId },
              data: { coverImageId: coverImage.id }
            })

            // Optionally clear thumbnailUrl from ServicePlaylistTrack (or keep as fallback)
            // For now, we'll keep it as a fallback in case the processed image fails to load
          } catch (error) {
            console.error(`Error processing image for track ${playlistTrack.trackId}:`, error)
            // Continue processing other tracks even if one fails
          }
        })
      )
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