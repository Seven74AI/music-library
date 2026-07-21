import { transformYouTubePlaylistItemToTrack } from "#app/types/transformations";
import { type YouTubePlaylistItem } from "#app/types/youtube-api";
import { type Prisma } from "#prisma/client.js";

/**
 * Internal track-processing contract used by the batch processor.
 * Not part of the public provider seam (fetch + normalize only).
 */
export interface TrackSyncProcessor {
  isDeletedVideo(item: any): boolean;
  shouldPreserveTrackData(existingTrack: { title: string } | null, item: any): boolean;
  transformPlaylistItem(
    item: any,
    serviceId: string,
    artistId: string,
  ): Omit<Prisma.TrackCreateInput, "artist"> & {
    artistId: string;
    thumbnailUrl?: string | null;
  };
}

export class YouTubeTrackSyncProcessor implements TrackSyncProcessor {
  isDeletedVideo(item: YouTubePlaylistItem): boolean {
    const title = item.snippet?.title || "";
    const videoId = item.snippet?.resourceId?.videoId;

    const deletedPatterns = [
      /^deleted video$/i,
      /^private video$/i,
      /^unavailable video$/i,
      /^video unavailable$/i,
      /^this video is unavailable$/i,
    ];

    const hasDeletedTitle = deletedPatterns.some((pattern) => pattern.test(title));
    const missingVideoId = !videoId || videoId.trim() === "";
    const missingThumbnail = !item.snippet?.thumbnails?.default?.url;

    return hasDeletedTitle || missingVideoId || missingThumbnail;
  }

  shouldPreserveTrackData(
    existingTrack: { title: string } | null,
    newItem: YouTubePlaylistItem,
  ): boolean {
    if (!existingTrack) return false;

    if (
      this.isDeletedVideo(newItem) &&
      existingTrack.title !== "Deleted video" &&
      existingTrack.title !== "Unknown Title"
    ) {
      return true;
    }

    return false;
  }

  transformPlaylistItem(
    item: YouTubePlaylistItem,
    serviceId: string,
    artistId: string,
  ): Omit<Prisma.TrackCreateInput, "artist"> & {
    artistId: string;
    thumbnailUrl?: string | null;
  } {
    return transformYouTubePlaylistItemToTrack(item, serviceId, artistId);
  }
}

export function createYouTubeTrackSyncProcessor(): YouTubeTrackSyncProcessor {
  return new YouTubeTrackSyncProcessor();
}
