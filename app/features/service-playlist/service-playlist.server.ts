/**
 * Service Playlist — public API.
 *
 * External modules MUST import from this file only. Sibling modules in this
 * feature are internal implementation details, not a stable public surface.
 *
 * Public exports:
 * - createServicePlaylistService, ServicePlaylistService, SyncServicePlaylistResult
 * - PendingMatch, SyncTrackInfo
 * - confirmOrphanedMatches — resolve pending deleted-video / orphan matches
 * - getServiceByName — resolve a Service row by name (import flows)
 * - SERVICE_PLAYLIST_TRACK_PAGE_SIZE — pagination size for playlist track queries
 *
 * Internal (do not import from outside this feature):
 * - batch-processor.server.ts, playlist-utils.server.ts,
 *   service-playlist-track-queries.server.ts, youtube-playlist-provider.server.ts,
 *   youtube-track-sync.server.ts, image-processor.server.ts,
 *   archive-enqueue-adapter.server.ts, playlist-sync-provider.server.ts,
 *   orphaned-match-confirm.server.ts, unavailable-item-plan.server.ts
 */
import { YOUTUBE_SERVICE } from "#app/constants/services";
import { resolveServiceAccessToken } from "#app/features/service-connection/service-connection.server";
import { type PlaylistWithTracks, type TrackWithUserStatus } from "#app/types/frontend";
import { type YouTubePlaylist } from "#app/types/youtube-api";
import { chunkArray } from "#app/utils/chunk-array";
import { prisma } from "#app/utils/db.server";
import {
  type ArchiveEnqueueAdapter,
  createProductionArchiveEnqueueAdapter,
} from "./archive-enqueue-adapter.server";
import {
  processTracksInBatches,
  resolveDeletedVideosAfterSync,
  type PendingMatch,
  type ProcessTracksResult,
  type SyncableItem,
  type SyncTrackInfo,
} from "./batch-processor.server";
import { processTrackImagesAsync } from "./image-processor.server";
import { type PlaylistSyncProvider } from "./playlist-sync-provider.server";
import { getServiceByName } from "./playlist-utils.server";
import { findAllServicePlaylistTracks } from "./service-playlist-track-queries.server";
import { createYouTubePlaylistProvider } from "./youtube-playlist-provider.server";
import {
  createYouTubeTrackSyncProcessor,
  type TrackSyncProcessor,
} from "./youtube-track-sync.server";

interface PlaylistWithSyncStatus extends YouTubePlaylist {
  isSynced: boolean;
  playlistInternalId: string | null;
}

const TRANSACTION_BATCH_SIZE = 15;

type ServiceProviderBundle = {
  syncProvider: PlaylistSyncProvider;
  trackProcessor: TrackSyncProcessor;
};

export type SyncServicePlaylistResult = {
  success: boolean;
  playlistId?: string;
  tracksAdded: number;
  totalTracks: number;
  deletedTracks: SyncTrackInfo[];
  removedTracks: SyncTrackInfo[];
  pendingMatches: PendingMatch[];
  message?: string;
  error?: string;
};

export class ServicePlaylistService {
  private providers: Map<string, ServiceProviderBundle>;
  private archiveEnqueueAdapter: ArchiveEnqueueAdapter;

  constructor(options?: { archiveEnqueueAdapter?: ArchiveEnqueueAdapter }) {
    this.providers = new Map();
    this.archiveEnqueueAdapter =
      options?.archiveEnqueueAdapter ?? createProductionArchiveEnqueueAdapter();

    this.registerProvider(
      YOUTUBE_SERVICE.NAME,
      createYouTubePlaylistProvider(),
      createYouTubeTrackSyncProcessor(),
    );
  }

  private registerProvider(
    serviceName: string,
    syncProvider: PlaylistSyncProvider,
    trackProcessor: TrackSyncProcessor,
  ): void {
    this.providers.set(serviceName, {
      syncProvider,
      trackProcessor,
    });
  }

  private getProviderBundle(serviceName: string): ServiceProviderBundle {
    const bundle = this.providers.get(serviceName);
    if (!bundle) {
      throw new Error(`Service ${serviceName} is not yet supported`);
    }
    return bundle;
  }

  private async processBatches(
    playlistItems: SyncableItem[],
    serviceId: string,
    playlistId: string,
    trackProcessor: TrackSyncProcessor,
    options?: {
      accessToken?: string;
      resolveVideoExistence?: PlaylistSyncProvider["resolveVideoExistence"];
    },
  ): Promise<{ result: ProcessTracksResult; timedOut: boolean }> {
    const totalItems = playlistItems.length;
    const accumulated: ProcessTracksResult = {
      processedCount: 0,
      deletedTracks: [],
      processedIds: {
        externalIds: new Set<string>(),
        trackIds: new Set<string>(),
      },
      pendingMatches: [],
      deletedVideosWithoutMatch: [],
      removeSptIds: new Set(),
      leaveAloneSptIds: new Set(),
    };

    for (let batchStart = 0; batchStart < totalItems; batchStart += TRANSACTION_BATCH_SIZE) {
      const batchItems = playlistItems.slice(batchStart, batchStart + TRANSACTION_BATCH_SIZE);

      try {
        const batchResult = await prisma.$transaction(
          async (tx) => {
            return processTracksInBatches(
              batchItems,
              serviceId,
              playlistId,
              tx,
              trackProcessor,
              this.archiveEnqueueAdapter,
              batchStart,
              accumulated.processedIds,
            );
          },
          { timeout: 30000 },
        );

        accumulated.processedCount += batchResult.processedCount;
        accumulated.deletedTracks.push(...batchResult.deletedTracks);
        batchResult.processedIds.externalIds.forEach((id) =>
          accumulated.processedIds.externalIds.add(id),
        );
        batchResult.processedIds.trackIds.forEach((id) =>
          accumulated.processedIds.trackIds.add(id),
        );
        accumulated.deletedVideosWithoutMatch.push(...batchResult.deletedVideosWithoutMatch);
      } catch (batchError) {
        console.error(
          `Error processing batch ${batchStart}-${batchStart + TRANSACTION_BATCH_SIZE}:`,
          batchError,
        );
        if (
          batchError instanceof Error &&
          (batchError.message.includes("expired transaction") ||
            batchError.message.includes("timeout"))
        ) {
          return { result: accumulated, timedOut: true };
        }
        throw batchError;
      }
    }

    const resolution = await resolveDeletedVideosAfterSync(
      playlistId,
      serviceId,
      accumulated.deletedVideosWithoutMatch,
      accumulated.processedIds,
      {
        accessToken: options?.accessToken,
        resolveVideoExistence: options?.resolveVideoExistence,
      },
    );

    accumulated.pendingMatches = resolution.pendingMatches;
    accumulated.deletedTracks.push(...resolution.deletedTracks);
    accumulated.processedCount += resolution.autoCreatedCount;
    accumulated.processedIds = resolution.processedIds;
    accumulated.removeSptIds = resolution.removeSptIds;
    accumulated.leaveAloneSptIds = resolution.leaveAloneSptIds;
    // Clear stubs once resolved so callers don't re-process
    accumulated.deletedVideosWithoutMatch = [];

    return { result: accumulated, timedOut: false };
  }

  private triggerImageProcessing(playlistId: string): void {
    void processTrackImagesAsync(playlistId).catch((error) => {
      console.error("Error processing track images in background:", error);
    });
  }

  async getAllPlaylistsWithSyncStatus(
    serviceName: string,
    userId: string,
  ): Promise<{
    playlists: PlaylistWithSyncStatus[];
    hasConnection: boolean;
    service: {
      id: string;
      name: string;
      displayName: string;
      baseUrl: string;
      isActive: boolean;
      createdAt: Date;
      updatedAt: Date;
    };
  }> {
    try {
      const service = await getServiceByName(serviceName);
      const { syncProvider } = this.getProviderBundle(serviceName);
      const tokenData = await resolveServiceAccessToken(serviceName, userId);

      if (!tokenData) {
        return {
          playlists: [],
          hasConnection: false,
          service,
        };
      }

      const allPlaylists = await syncProvider.fetchPlaylists(tokenData.access_token, userId);

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
      });

      const syncedPlaylistIds = new Set(syncedPlaylists.map((p) => p.externalId));
      const syncedPlaylistInternalIds = new Map(syncedPlaylists.map((p) => [p.externalId, p.id]));

      const playlistsWithSyncStatus: PlaylistWithSyncStatus[] = allPlaylists.map((playlist) => ({
        ...playlist,
        isSynced: syncedPlaylistIds.has(playlist.id || ""),
        playlistInternalId: syncedPlaylistInternalIds.get(playlist.id || "") || null,
      }));

      return {
        playlists: playlistsWithSyncStatus,
        hasConnection: true,
        service,
      };
    } catch (error) {
      console.error(`Error fetching playlists for ${serviceName}:`, error);
      return {
        playlists: [],
        hasConnection: false,
        service: await getServiceByName(serviceName),
      };
    }
  }

  /**
   * Unified playlist sync entry point — first-time registration and re-sync.
   *
   * Accepts either an internal ServicePlaylist id (re-sync) or an external
   * service playlist id (first-time sync).
   */
  async syncServicePlaylist(
    serviceName: string,
    playlistId: string,
    userId: string,
  ): Promise<SyncServicePlaylistResult> {
    try {
      const service = await getServiceByName(serviceName);
      const existingPlaylist = await prisma.servicePlaylist.findFirst({
        where: {
          id: playlistId,
          serviceId: service.id,
          ownerId: userId,
          isActive: true,
        },
      });

      if (existingPlaylist) {
        return this.resyncExistingPlaylist(serviceName, existingPlaylist, userId);
      }

      return this.registerAndSyncPlaylist(serviceName, playlistId, userId);
    } catch (error) {
      console.error("Error syncing service playlist:", error);
      const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred";
      return {
        success: false,
        tracksAdded: 0,
        totalTracks: 0,
        deletedTracks: [],
        removedTracks: [],
        pendingMatches: [],
        error: errorMessage,
        message: `Failed to sync playlist: ${errorMessage}`,
      };
    }
  }

  private async registerAndSyncPlaylist(
    serviceName: string,
    externalPlaylistId: string,
    userId: string,
  ): Promise<SyncServicePlaylistResult> {
    const service = await getServiceByName(serviceName);
    const tokenData = await resolveServiceAccessToken(serviceName, userId);
    if (!tokenData) {
      return {
        success: false,
        tracksAdded: 0,
        totalTracks: 0,
        deletedTracks: [],
        removedTracks: [],
        pendingMatches: [],
        error: `No valid tokens found for service: ${serviceName}`,
        message: `Failed to sync playlist: No valid tokens found for service: ${serviceName}`,
      };
    }

    const { syncProvider, trackProcessor } = this.getProviderBundle(serviceName);
    const [rawPlaylist, playlistItems] = await Promise.all([
      syncProvider.fetchPlaylist(externalPlaylistId, tokenData.access_token),
      syncProvider.fetchPlaylistItems(externalPlaylistId, tokenData.access_token),
    ]);

    const playlistData = syncProvider.normalizePlaylistData(rawPlaylist, service.id, userId);

    const playlist = await prisma.servicePlaylist.upsert({
      where: {
        serviceId_externalId_ownerId: {
          serviceId: service.id,
          externalId: externalPlaylistId,
          ownerId: userId,
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
    });

    const { result: processResult, timedOut } = await this.processBatches(
      playlistItems as SyncableItem[],
      service.id,
      playlist.id,
      trackProcessor,
      {
        accessToken: tokenData.access_token,
        resolveVideoExistence: syncProvider.resolveVideoExistence,
      },
    );

    if (timedOut) {
      return {
        success: false,
        playlistId: playlist.id,
        tracksAdded: processResult.processedCount,
        totalTracks: playlistItems.length,
        deletedTracks: processResult.deletedTracks,
        removedTracks: [],
        pendingMatches: processResult.pendingMatches,
        error: "Transaction timeout",
        message:
          "The playlist sync took too long and timed out. This may happen with very large playlists. Please try again or contact support if the issue persists.",
      };
    }

    this.triggerImageProcessing(playlist.id);

    return {
      success: true,
      playlistId: playlist.id,
      tracksAdded: processResult.processedCount,
      totalTracks: playlistItems.length,
      deletedTracks: processResult.deletedTracks,
      removedTracks: [],
      pendingMatches: processResult.pendingMatches,
      message: `Playlist synced successfully. ${processResult.processedCount} tracks processed.`,
    };
  }

  private async resyncExistingPlaylist(
    serviceName: string,
    playlist: {
      id: string;
      externalId: string;
      serviceId: string;
    },
    userId: string,
  ): Promise<SyncServicePlaylistResult> {
    const service = await getServiceByName(serviceName);
    const tokenData = await resolveServiceAccessToken(serviceName, userId);
    if (!tokenData) {
      throw new Error(`No valid tokens found for service: ${serviceName}`);
    }

    const { syncProvider, trackProcessor } = this.getProviderBundle(serviceName);
    let playlistItems: Awaited<ReturnType<typeof syncProvider.fetchPlaylistItems>>;
    try {
      playlistItems = await syncProvider.fetchPlaylistItems(
        playlist.externalId,
        tokenData.access_token,
      );
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error("Failed to fetch playlist items from external service");
    }

    const { result: processResult, timedOut } = await this.processBatches(
      playlistItems as SyncableItem[],
      service.id,
      playlist.id,
      trackProcessor,
      {
        accessToken: tokenData.access_token,
        resolveVideoExistence: syncProvider.resolveVideoExistence,
      },
    );

    if (timedOut) {
      return {
        success: false,
        playlistId: playlist.id,
        tracksAdded: processResult.processedCount,
        totalTracks: playlistItems.length,
        deletedTracks: processResult.deletedTracks,
        removedTracks: [],
        pendingMatches: processResult.pendingMatches,
        message:
          "The playlist sync took too long and timed out. Some tracks may have been synced. Please try again.",
      };
    }

    const existingPlaylistTracks = await findAllServicePlaylistTracks(prisma, {
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
    });

    const removedTracks: SyncTrackInfo[] = [];
    const tracksToRemove: string[] = [];

    for (const playlistTrack of existingPlaylistTracks) {
      if (!processResult.removeSptIds.has(playlistTrack.id)) {
        continue;
      }

      const externalId = playlistTrack.track.externalId;
      const trackId = playlistTrack.track.id;

      removedTracks.push({
        id: trackId,
        title: playlistTrack.track.title,
        ...(externalId && { externalId }),
      });
      tracksToRemove.push(playlistTrack.id);
    }

    if (tracksToRemove.length > 0) {
      for (const idChunk of chunkArray(tracksToRemove)) {
        await prisma.servicePlaylistTrack.deleteMany({
          where: {
            id: { in: idChunk },
          },
        });
      }
    }

    await prisma.servicePlaylist.update({
      where: { id: playlist.id },
      data: {
        itemCount: playlistItems.length,
        lastSyncedAt: new Date(),
        archiveReadyNotifiedAt: null,
      },
    });

    this.triggerImageProcessing(playlist.id);

    return {
      success: true,
      playlistId: playlist.id,
      tracksAdded: processResult.processedCount,
      totalTracks: playlistItems.length,
      deletedTracks: processResult.deletedTracks,
      removedTracks,
      pendingMatches: processResult.pendingMatches,
      message: `Playlist synced successfully. ${processResult.processedCount} tracks processed.`,
    };
  }

  async getSyncedPlaylists(serviceName: string, userId: string) {
    const service = await getServiceByName(serviceName);

    return prisma.servicePlaylist.findMany({
      where: {
        serviceId: service.id,
        ownerId: userId,
        isActive: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });
  }

  async removePlaylistFromSync(serviceName: string, id: string, userId: string) {
    this.getProviderBundle(serviceName);

    const service = await getServiceByName(serviceName);

    try {
      const result = await prisma.servicePlaylist.deleteMany({
        where: {
          serviceId: service.id,
          id,
          ownerId: userId,
        },
      });

      return {
        success: result.count > 0,
        message:
          result.count > 0
            ? "Playlist removed from sync successfully"
            : "Playlist not found or already removed",
      };
    } catch (error) {
      console.error("Error removing playlist from sync:", error);
      return {
        success: false,
        message: "Failed to remove playlist from sync",
      };
    }
  }

  async getPlaylistTracks(serviceName: string, playlistId: string, userId: string) {
    const service = await getServiceByName(serviceName);

    const playlist = await prisma.servicePlaylist.findFirst({
      where: {
        id: playlistId,
        serviceId: service.id,
        ownerId: userId,
        isActive: true,
      },
    });

    if (!playlist) {
      throw new Error("Playlist not found or access denied");
    }

    const playlistTracks = (
      await findAllServicePlaylistTracks(prisma, {
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
      })
    ).sort((a, b) => a.position - b.position);

    return {
      playlist,
      tracks: playlistTracks.map((pt) => ({
        ...pt.track,
        artist: pt.track.artist || { id: "", name: "Unknown Artist" },
        position: pt.position,
        isDeleted: pt.isDeleted,
        deletedAt: pt.deletedAt,
        thumbnailUrl: pt.thumbnailUrl,
      })),
    };
  }

  async getPlaylistTracksWithUserStatus(
    playlistId: string,
    userId: string,
    serviceName: string = "youtube",
  ): Promise<{
    playlist: PlaylistWithTracks;
    tracks: TrackWithUserStatus[];
  }> {
    const result = await this.getPlaylistTracks(serviceName, playlistId, userId);

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
    });
    const libraryTrackIds = new Set(userTracks.map((ut) => ut.trackId));

    const playlist: PlaylistWithTracks = {
      ...result.playlist,
      tracks: [],
    };

    const tracks: TrackWithUserStatus[] = result.tracks.map((track) => ({
      ...track,
      artist: track.artist || { id: "", name: "Unknown Artist" },
      isDeleted: track.isDeleted || false,
      deletedAt: track.deletedAt || null,
      coverImage: track.coverImage
        ? {
            objectKey: track.coverImage.objectKey,
          }
        : null,
      thumbnailUrl: (track as { thumbnailUrl?: string | null }).thumbnailUrl || null,
      service: track.service
        ? {
            name: track.service.name,
            displayName: track.service.displayName,
            logoUrl: track.service.logoUrl,
          }
        : undefined,
      audioFiles: track.audioFiles?.map((af) => ({
        id: af.id,
        format: af.format,
        objectKey: af.objectKey,
      })),
      isInUserLibrary: libraryTrackIds.has(track.id),
    }));

    playlist.tracks = tracks;

    return {
      playlist,
      tracks,
    };
  }
}

export function createServicePlaylistService(options?: {
  archiveEnqueueAdapter?: ArchiveEnqueueAdapter;
}): ServicePlaylistService {
  return new ServicePlaylistService(options);
}

export type { PendingMatch, SyncTrackInfo };
export { confirmOrphanedMatches } from "./orphaned-match-confirm.server";
export { getServiceByName } from "./playlist-utils.server";
export { SERVICE_PLAYLIST_TRACK_PAGE_SIZE } from "./service-playlist-track-queries.server";
