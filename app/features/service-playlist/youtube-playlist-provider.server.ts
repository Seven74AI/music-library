import { YOUTUBE_SERVICE } from "#app/constants/services";
import { transformYouTubePlaylistToServicePlaylist } from "#app/types/transformations";
import { type YouTubePlaylist, type YouTubePlaylistItem } from "#app/types/youtube-api";
import { createYouTubeService, type YouTubeService } from "#app/utils/youtube.server";
import { type PlaylistSyncProvider } from "./playlist-sync-provider.server";

export class YouTubePlaylistProvider implements PlaylistSyncProvider {
  private youtubeService: YouTubeService;

  constructor(youtubeService?: YouTubeService) {
    this.youtubeService = youtubeService ?? createYouTubeService();
  }

  async fetchPlaylists(token: string, _userId: string): Promise<YouTubePlaylist[]> {
    return this.youtubeService.getUserPlaylists(token);
  }

  async fetchPlaylist(externalId: string, token: string): Promise<YouTubePlaylist> {
    return this.youtubeService.getPlaylist(externalId, token);
  }

  async fetchPlaylistItems(externalId: string, token: string): Promise<YouTubePlaylistItem[]> {
    return this.youtubeService.getPlaylistItems(externalId, token);
  }

  supportsService(serviceName: string): boolean {
    return serviceName === YOUTUBE_SERVICE.NAME;
  }

  normalizePlaylistData(
    rawPlaylist: unknown,
    serviceId: string,
    userId: string,
  ): {
    title: string;
    description: string | null;
    externalId: string;
    itemCount: number;
    channelId: string | null;
    channelTitle: string | null;
    thumbnailUrl: string | null;
  } {
    const data = transformYouTubePlaylistToServicePlaylist(
      rawPlaylist as YouTubePlaylist,
      serviceId,
      userId,
    );
    return {
      title: data.title,
      description: data.description ?? null,
      externalId: data.externalId,
      itemCount: data.itemCount,
      channelId: data.channelId ?? null,
      channelTitle: data.channelTitle ?? null,
      thumbnailUrl: data.thumbnailUrl ?? null,
    };
  }
}

export function createYouTubePlaylistProvider(
  youtubeService?: YouTubeService,
): YouTubePlaylistProvider {
  return new YouTubePlaylistProvider(youtubeService);
}
