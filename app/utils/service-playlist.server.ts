import { YOUTUBE_SERVICE } from '#app/constants/services'
import { 
  type PlaylistWithTracks,
  type TrackWithUserStatus
} from '#app/types/frontend'
import { 
  type YouTubePlaylist,
} from '#app/types/youtube-api'
import { chunkArray } from '#app/utils/chunk-array'
import { prisma } from '#app/utils/db.server'
import { type PlaylistSyncProvider } from './playlist-sync-provider.server'
import { getServiceByName, getUserConnection, parseConnectionTokens } from './playlist-utils.server'
import {
  processTracksInBatches,
  type ProcessTracksResult,
  type SyncTrackInfo,
  type PendingMatch,
  confirmDeletedVideoMatches as doConfirmMatches
} from './track-batch-processor.server'
import {
  processTrackImagesAsync,
} from './track-image-processor.server'
import { createYouTubePlaylistProvider } from './youtube-playlist-provider.server'

/**
 * Extended playlist interface with sync status information
 * Combines service playlist data with internal sync tracking
 */
interface PlaylistWithSyncStatus extends YouTubePlaylist {
  isSynced: boolean
  playlistInternalId: string | null
}

/**
 * Transaction batch size for playlist sync.
 * Processes 15 tracks per Prisma transaction to avoid timeouts on large playlists.
 */
const TRANSACTION_BATCH_SIZE = 15

export class ServicePlaylistService {
  private providers: Map<string, PlaylistSyncProvider>

  constructor() {
    this.providers = new Map()
    // Register YouTube provider
    const youtubeProvider = createYouTubePlaylistProvider()
    this.providers.set(YOUTUBE_SERVICE.NAME, youtubeProvider)
  }

  /**
   * Resolve the provider for a given service name.
   * Throws if no provider is registered for the service.
   */
  private getProvider(serviceName: string): PlaylistSyncProvider {
    const provider = this.providers.get(serviceName)
    if (!provider) {
      throw new Error(`Service ${serviceName} is not yet supported`)
    }
    return provider
  }

  /**
   * Process playlist items in transaction-sized batches.
   * Shared by addPlaylistToSync and syncPlaylistTracks to eliminate duplicate
   * batch orchestration logic.
   *
   * @returns Accumulated ProcessTracksResult across all batches
   * @throws On non-timeout errors (re-thrown for caller to handle)
   */
  private async processBatches(
    playlistItems: any[],
    serviceId: string,
    playlistId: string,
    provider: PlaylistSyncProvider,
  ): Promise<{ result: ProcessTracksResult; timedOut: boolean }> {
    const totalItems = playlistItems.length
    const accumulated: ProcessTracksResult = {
      processedCount: 0,
      deletedTracks: [],
      processedExternalIds: new Set<string>(),
      processedTrackIds: new Set<string>(),
      pendingMatches: [],
    }

    for (let batchStart = 0; batchStart < totalItems; batchStart += TRANSACTION_BATCH_SIZE) {
      const batchItems = playlistItems.slice(batchStart, batchStart + TRANSACTION_BATCH_SIZE)

      try {
        const batchResult = await prisma.$transaction(async (tx) => {
          return processTracksInBatches(
            batchItems,
            serviceId,
            playlistId,
            tx,
            provider,
            batchStart,
            accumulated.processedExternalIds,
            accumulated.processedTrackIds,
          )
        }, { timeout: 30000 })

        accumulated.processedCount += batchResult.processedCount
        accumulated.deletedTracks.push(...batchResult.deletedTracks)
        batchResult.processedExternalIds.forEach(id => accumulated.processedExternalIds.add(id))
        batchResult.processedTrackIds.forEach(id => accumulated.processedTrackIds.add(id))
        accumulated.pendingMatches.push(...batchResult.pendingMatches)
      } catch (batchError) {
        console.error(
          `Error processing batch ${batchStart}-${batchStart + TRANSACTION_BATCH_SIZE}:`,
          batchError,
        )
        if (
          batchError instanceof Error &&
          (batchError.message.includes('expired transaction') || batchError.message.includes('timeout'))
        ) {
          return { result: accumulated, timedOut: true }
        }
        throw batchError
      }
    }

    return { result: accumulated, timedOut: false }
  }

  /**
   * Fire-and-forget background image processing.
   * Shared by addPlaylistToSync and syncPlaylistTracks.
   */
  private async triggerImageProcessing(playlistId: string): Promise<void> {
    void processTrackImagesAsync(playlistId).catch(error => {
      console.error('Error processing track images in background:', error)
    })
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
      const service = await getServiceByName(serviceName)
      const provider = this.getProvider(serviceName)

      // Validate OAuth connection via provider (not YouTube-specific)
      const connectionValidation = await provider.validateConnection(userId)

      if (!connectionValidation) {
        return {
          playlists: [],
          hasConnection: false,
          service,
        }
      }

      // Delegate to the appropriate service provider
      const allPlaylists = await provider.fetchPlaylists(connectionValidation.access_token, userId)

      // Get already synced playlists
      const syncedPlaylists = await prisma.servicePlaylist.findMany({
        where: {
          serviceId: service.id,
          ownerId: userId,
          isActive: true,
        },
        select: {
          externalId: true,
          id: true,
        },
      })

      const syncedPlaylistIds = new Set(syncedPlaylists.map(p => p.externalId))
      const syncedPlaylistInternalIds = new Map(syncedPlaylists.map(p => [p.externalId, p.id]))

      // Combine API playlists with sync status
      const playlistsWithSyncStatus: PlaylistWithSyncStatus[] = allPlaylists.map(playlist => ({
        ...playlist,
        isSynced: syncedPlaylistIds.has(playlist.id || ''),
        playlistInternalId: syncedPlaylistInternalIds.get(playlist.id || '') || null,
      }))

      return {
        playlists: playlistsWithSyncStatus,
        hasConnection: true,
        service,
      }
    } catch (error) {
      console.error(`Error fetching playlists for ${serviceName}:`, error)
      return {
        playlists: [],
        hasConnection: false,
        service: await getServiceByName(serviceName),
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
      const service = await getServiceByName(serviceName)
      const connection = await getUserConnection(serviceName, userId)
      const tokenData = parseConnectionTokens(connection)

      // Delegate to the appropriate service provider
      const provider = this.getProvider(serviceName)
      const [youtubePlaylist, playlistItems] = await Promise.all([
        provider.fetchPlaylist(externalPlaylistId, tokenData.access_token),
        provider.fetchPlaylistItems(externalPlaylistId, tokenData.access_token),
      ])

      // Normalize playlist data through provider (not YouTube-specific)
      const playlistData = provider.normalizePlaylistData(youtubePlaylist, service.id, userId)

      // Create or update playlist in database
      const playlist = await prisma.servicePlaylist.upsert({
        where: {
          serviceId_externalId: {
            serviceId: service.id,
            externalId: externalPlaylistId,
          },
        },
        update: {
          ...playlistData,
          serviceId: service.id,
          ownerId: userId,
          lastSyncedAt: new Date(),
          isActive: true,
        },
        create: {
          ...playlistData,
          serviceId: service.id,
          ownerId: userId,
          lastSyncedAt: new Date(),
          isActive: true,
        },
      })

      // Process tracks in transaction batches
      const { result: processResult, timedOut } = await this.processBatches(
        playlistItems,
        service.id,
        playlist.id,
        provider,
      )

      if (timedOut) {
        return {
          success: false,
          error: 'Transaction timeout',
          message:
            'The playlist sync took too long and timed out. This may happen with very large playlists. Please try again or contact support if the issue persists.',
        }
      }

      // Trigger background image processing
      await this.triggerImageProcessing(playlist.id)

      return {
        success: true,
        playlistId: playlist.id,
        tracksAdded: processResult.processedCount,
        totalTracks: playlistItems.length,
        pendingMatches: processResult.pendingMatches,
      }
    } catch (error) {
      console.error('Error adding playlist to sync:', error)
      const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred'
      return {
        success: false,
        error: errorMessage,
        message: `Failed to sync playlist: ${errorMessage}`,
      }
    }
  }

  /**
   * Get synced playlists for a user
   */
  async getSyncedPlaylists(serviceName: string, userId: string) {
    const service = await getServiceByName(serviceName)

    return await prisma.servicePlaylist.findMany({
      where: {
        serviceId: service.id,
        ownerId: userId,
        isActive: true,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    })
  }

  /**
   * Remove playlist from sync
   */
  async removePlaylistFromSync(serviceName: string, id: string, userId: string) {
    this.getProvider(serviceName) // Validate service is supported

    const service = await getServiceByName(serviceName)

    try {
      const result = await prisma.servicePlaylist.deleteMany({
        where: {
          serviceId: service.id,
          id,
          ownerId: userId,
        },
      })

      return {
        success: result.count > 0,
        message:
          result.count > 0
            ? 'Playlist removed from sync successfully'
            : 'Playlist not found or already removed',
      }
    } catch (error) {
      console.error('Error removing playlist from sync:', error)
      return {
        success: false,
        message: 'Failed to remove playlist from sync',
      }
    }
  }

  /**
   * Get playlist tracks with details
   */
  async getPlaylistTracks(serviceName: string, playlistId: string, userId: string) {
    const service = await getServiceByName(serviceName)

    // Verify playlist belongs to user
    const playlist = await prisma.servicePlaylist.findFirst({
      where: {
        id: playlistId,
        serviceId: service.id,
        ownerId: userId,
        isActive: true,
      },
    })

    if (!playlist) {
      throw new Error('Playlist not found or access denied')
    }

    // Get tracks with their details
    const playlistTracks = await prisma.servicePlaylistTrack.findMany({
      where: {
        playlistId: playlist.id,
      },
      include: {
        track: {
          include: {
            artist: {
              select: {
                id: true,
                name: true,
              },
            },
            coverImage: {
              select: {
                objectKey: true,
              },
            },
            service: {
              select: {
                name: true,
                displayName: true,
                logoUrl: true,
              },
            },
            audioFiles: true,
          },
        },
      },
      orderBy: {
        position: 'asc',
      },
    })

    return {
      playlist,
      tracks: playlistTracks.map(pt => ({
        ...pt.track,
        artist: pt.track.artist || { id: '', name: 'Unknown Artist' },
        position: pt.position,
        isDeleted: pt.isDeleted,
        deletedAt: pt.deletedAt,
        thumbnailUrl: pt.thumbnailUrl,
      })),
    }
  }

  /**
   * Get playlist tracks with user library status for frontend display
   */
  async getPlaylistTracksWithUserStatus(
    playlistId: string,
    userId: string,
    serviceName: string = 'youtube',
  ): Promise<{
    playlist: PlaylistWithTracks
    tracks: TrackWithUserStatus[]
  }> {
    // Get playlist with tracks — use provided serviceName instead of hardcoded 'youtube'
    const result = await this.getPlaylistTracks(serviceName, playlistId, userId)

    // Determine which tracks are in the user's personal library (relational query — no giant IN clause)
    const userTracks = await prisma.userTrack.findMany({
      where: {
        userId,
        isActive: true,
        track: {
          servicePlaylistTracks: {
            some: { playlistId },
          },
        },
      },
      select: { trackId: true },
    })
    const libraryTrackIds = new Set(userTracks.map(ut => ut.trackId))

    // Transform to type-safe frontend format
    const playlist: PlaylistWithTracks = {
      ...result.playlist,
      tracks: [],
    }

    const tracks: TrackWithUserStatus[] = result.tracks.map(track => ({
      ...track,
      artist: track.artist || { id: '', name: 'Unknown Artist' },
      isDeleted: track.isDeleted || false,
      deletedAt: track.deletedAt || null,
      coverImage: track.coverImage
        ? {
            objectKey: track.coverImage.objectKey,
          }
        : null,
      thumbnailUrl: (track as any).thumbnailUrl || null,
      service: track.service
        ? {
            name: track.service.name,
            displayName: track.service.displayName,
            logoUrl: track.service.logoUrl,
          }
        : undefined,
      audioFiles: track.audioFiles?.map(af => ({
        id: af.id,
        format: af.format,
        objectKey: af.objectKey,
      })),
      isInUserLibrary: libraryTrackIds.has(track.id),
    }))

    // Update playlist tracks
    playlist.tracks = tracks

    return {
      playlist,
      tracks,
    }
  }

  /**
   * Resync a playlist (refresh tracks from external service)
   */
  async resyncPlaylist(
    playlistId: string,
    userId: string,
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
        include: { service: true },
      })

      if (!playlist) {
        return {
          success: false,
          tracksAdded: 0,
          totalTracks: 0,
          deletedTracks: [],
          removedTracks: [],
          pendingMatches: [],
          message:
            'Playlist not found. It may have been removed or you may not have access to it.',
          error:
            'Playlist not found. It may have been removed or you may not have access to it.',
        }
      }

      // Use the existing sync method
      const result = await this.syncPlaylistTracks(playlist.service.name, playlistId, userId)
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
        error: errorMessage,
      }
    }
  }

  async syncPlaylistTracks(
    serviceName: string,
    playlistId: string,
    userId: string,
  ): Promise<{
    success: boolean
    tracksAdded: number
    totalTracks: number
    deletedTracks: SyncTrackInfo[]
    removedTracks: SyncTrackInfo[]
    pendingMatches: PendingMatch[]
    message: string
  }> {
    const service = await getServiceByName(serviceName)
    const connection = await getUserConnection(serviceName, userId)
    const tokenData = parseConnectionTokens(connection)

    // Get playlist details
    const playlist = await prisma.servicePlaylist.findFirst({
      where: {
        id: playlistId,
        serviceId: service.id,
        ownerId: userId,
        isActive: true,
      },
    })

    if (!playlist) {
      throw new Error('Playlist not found or access denied')
    }

    // Delegate to the appropriate service provider
    const provider = this.getProvider(serviceName)
    let playlistItems: Awaited<ReturnType<typeof provider.fetchPlaylistItems>>
    try {
      playlistItems = await provider.fetchPlaylistItems(playlist.externalId, tokenData.access_token)
    } catch (error) {
      if (error instanceof Error) {
        throw error
      }
      throw new Error('Failed to fetch playlist items from external service')
    }

    // Process tracks in transaction batches (shared with addPlaylistToSync)
    const { result: processResult, timedOut } = await this.processBatches(
      playlistItems,
      service.id,
      playlist.id,
      provider,
    )

    if (timedOut) {
      return {
        success: false,
        tracksAdded: processResult.processedCount,
        totalTracks: playlistItems.length,
        deletedTracks: processResult.deletedTracks,
        removedTracks: [],
        pendingMatches: processResult.pendingMatches,
        message:
          'The playlist sync took too long and timed out. Some tracks may have been synced. Please try again.',
      }
    }

    // Find tracks that were removed from playlist (exist in DB but not in current sync)
    const existingPlaylistTracks = await prisma.servicePlaylistTrack.findMany({
      where: {
        playlistId: playlist.id,
      },
      include: {
        track: {
          select: {
            id: true,
            title: true,
            externalId: true,
          },
        },
      },
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
        removedTracks.push({
          id: trackId,
          title: playlistTrack.track.title,
          ...(externalId && { externalId }),
        })
        tracksToRemove.push(playlistTrack.id)
      }
    }

    // Remove tracks that are no longer in the playlist
    if (tracksToRemove.length > 0) {
      for (const idChunk of chunkArray(tracksToRemove)) {
        await prisma.servicePlaylistTrack.deleteMany({
          where: {
            id: { in: idChunk },
          },
        })
      }
    }

    // Update playlist metadata
    await prisma.servicePlaylist.update({
      where: { id: playlist.id },
      data: {
        itemCount: playlistItems.length,
        lastSyncedAt: new Date(),
        archiveReadyNotifiedAt: null,
      },
    })

    // Trigger background image processing
    await this.triggerImageProcessing(playlist.id)

    return {
      success: true,
      tracksAdded: processResult.processedCount,
      totalTracks: playlistItems.length,
      deletedTracks: processResult.deletedTracks,
      removedTracks,
      pendingMatches: processResult.pendingMatches,
      message: `Playlist synced successfully. ${processResult.processedCount} tracks processed.`,
    }
  }

  /**
   * Confirm deleted video matches - process user selections for pending matches.
   * Delegates to the extracted function in track-batch-processor.
   */
  async confirmDeletedVideoMatches(
    playlistId: string,
    matches: Array<{
      deletedItemId: string | undefined
      selectedTrackId: string | null
      position: number
      action: 'match' | 'new' | 'skip'
    }>,
    userId: string,
  ): Promise<{
    success: boolean
    processedCount: number
    message: string
    error?: string
  }> {
    return doConfirmMatches(playlistId, matches, userId)
  }

  /**
   * Add a track to the user's personal library.
   * Creates a UserTrack record (idempotent — reactivates if already exists but inactive).
   */
  async addTrackToUserLibrary(
    trackId: string,
    userId: string,
  ): Promise<{ success: boolean; message: string; error?: string }> {
    try {
      const existing = await prisma.userTrack.findUnique({
        where: {
          userId_trackId: { userId, trackId },
        },
      })

      if (existing) {
        if (existing.isActive) {
          return { success: true, message: 'Track already in library' }
        }
        // Reactivate soft-deleted record
        await prisma.userTrack.update({
          where: { id: existing.id },
          data: { isActive: true, deletedAt: null },
        })
        return { success: true, message: 'Track re-added to library' }
      }

      await prisma.userTrack.create({
        data: { userId, trackId },
      })
      return { success: true, message: 'Track added to library' }
    } catch (error) {
      console.error('Error adding track to user library:', error)
      return {
        success: false,
        message: 'Failed to add track to library',
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Add multiple tracks to the user's personal library in one operation.
   * Skips tracks already active; reactivates soft-deleted records.
   */
  async addTracksToUserLibrary(
    trackIds: string[],
    userId: string,
  ): Promise<{
    success: boolean
    message: string
    addedCount: number
    error?: string
  }> {
    const uniqueTrackIds = [
      ...new Set(
        trackIds.filter(
          (id): id is string => typeof id === 'string' && id.trim().length > 0,
        ),
      ),
    ]

    if (uniqueTrackIds.length === 0) {
      return {
        success: true,
        message: 'No tracks to add',
        addedCount: 0,
      }
    }

    try {
      const existing = []
      for (const trackIdChunk of chunkArray(uniqueTrackIds)) {
        const batch = await prisma.userTrack.findMany({
          where: {
            userId,
            trackId: { in: trackIdChunk },
          },
        })
        existing.push(...batch)
      }

      const existingByTrackId = new Map(
        existing.map((userTrack) => [userTrack.trackId, userTrack]),
      )
      const toReactivate = existing
        .filter((userTrack) => !userTrack.isActive)
        .map((userTrack) => userTrack.id)
      const toCreate = uniqueTrackIds.filter(
        (trackId) => !existingByTrackId.has(trackId),
      )

      await prisma.$transaction(async (tx) => {
        for (const idChunk of chunkArray(toReactivate)) {
          await tx.userTrack.updateMany({
            where: { id: { in: idChunk } },
            data: { isActive: true, deletedAt: null },
          })
        }
        for (const trackIdChunk of chunkArray(toCreate)) {
          await tx.userTrack.createMany({
            data: trackIdChunk.map((trackId) => ({ userId, trackId })),
          })
        }
      })

      const addedCount = toReactivate.length + toCreate.length
      return {
        success: true,
        message: `${addedCount} track${addedCount !== 1 ? 's' : ''} added to library`,
        addedCount,
      }
    } catch (error) {
      console.error('Error adding tracks to user library:', error)
      return {
        success: false,
        message: 'Failed to add tracks to library',
        addedCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Remove a track from the user's personal library (soft delete).
   */
  async removeTrackFromUserLibrary(
    trackId: string,
    userId: string,
  ): Promise<{ success: boolean; message: string; error?: string }> {
    try {
      const existing = await prisma.userTrack.findUnique({
        where: {
          userId_trackId: { userId, trackId },
        },
      })

      if (!existing || !existing.isActive) {
        return { success: false, message: 'Track not found in library' }
      }

      await prisma.userTrack.update({
        where: { id: existing.id },
        data: { isActive: false, deletedAt: new Date() },
      })
      return { success: true, message: 'Track removed from library' }
    } catch (error) {
      console.error('Error removing track from user library:', error)
      return {
        success: false,
        message: 'Failed to remove track from library',
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }
}

/**
   * Factory function to create a new ServicePlaylistService instance
 */
export function createServicePlaylistService(): ServicePlaylistService {
  return new ServicePlaylistService()
}
