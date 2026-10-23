import { transformYouTubePlaylistItemToTrack } from "#app/types/transformations";
import { type YouTubePlaylistItem } from "#app/types/youtube-api";
import { type Prisma } from "#prisma/client.js";
import { type SyncableItem } from "./batch-processor.server";

const UNAVAILABLE_TITLE_PATTERNS = [
  /^deleted video$/i,
  /^private video$/i,
  /^unavailable video$/i,
  /^video unavailable$/i,
  /^this video is unavailable$/i,
];

const PLACEHOLDER_TITLE_PATTERNS = [...UNAVAILABLE_TITLE_PATTERNS, /^unknown title$/i];

function isPlaceholderTitle(title: string): boolean {
  return PLACEHOLDER_TITLE_PATTERNS.some((pattern) => pattern.test(title));
}

/**
 * Internal track-processing contract used by the batch processor.
 * Not part of the public provider seam (fetch + normalize only).
 */
export interface TrackSyncProcessor {
  isUnavailableVideo(item: SyncableItem): boolean;
  shouldPreserveTrackData(existingTrack: { title: string } | null, item: SyncableItem): boolean;
  transformPlaylistItem(
    item: SyncableItem,
    serviceId: string,
    artistId: string,
  ): Prisma.TrackUncheckedCreateInput & {
    thumbnailUrl?: string | null;
  };
}

export class YouTubeTrackSyncProcessor implements TrackSyncProcessor {
  isUnavailableVideo(item: YouTubePlaylistItem): boolean {
    const title = item.snippet?.title || "";
    const videoId = item.snippet?.resourceId?.videoId;

    const hasUnavailableTitle = UNAVAILABLE_TITLE_PATTERNS.some((pattern) => pattern.test(title));
    const missingVideoId = !videoId || videoId.trim() === "";

    return hasUnavailableTitle || missingVideoId;
  }

  shouldPreserveTrackData(
    existingTrack: { title: string } | null,
    newItem: YouTubePlaylistItem,
  ): boolean {
    if (!existingTrack) return false;

    if (this.isUnavailableVideo(newItem) && !isPlaceholderTitle(existingTrack.title)) {
      return true;
    }

    return false;
  }

  transformPlaylistItem(
    item: YouTubePlaylistItem,
    serviceId: string,
    artistId: string,
  ): Prisma.TrackUncheckedCreateInput & {
    thumbnailUrl?: string | null;
  } {
    return transformYouTubePlaylistItemToTrack(item, serviceId, artistId);
  }
}

export function createYouTubeTrackSyncProcessor(): YouTubeTrackSyncProcessor {
  return new YouTubeTrackSyncProcessor();
}
