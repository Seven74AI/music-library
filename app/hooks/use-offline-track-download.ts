import { useCallback, useState } from "react";
import { toast } from "#app/components/ui/use-toast.ts";
import { getOfflineStorage } from "#app/features/offline-storage/offline-storage.client.ts";
import { useOfflineTrackStatus } from "#app/hooks/use-offline-track-status.ts";
import { type FullTrack } from "#app/types/frontend/shared";

export type OfflineDownloadTrack = Pick<
  FullTrack,
  "id" | "title" | "artist" | "duration" | "coverImage" | "audioFiles"
>;

export function useOfflineTrackDownload(track: OfflineDownloadTrack, playlistId?: string) {
  const { isDownloaded, isPinned, isBusy, setIsBusy, refresh } = useOfflineTrackStatus(track.id);
  const [isWorking, setIsWorking] = useState(false);

  const hasAudio = Boolean(track.audioFiles && track.audioFiles.length > 0);
  const label = isDownloaded && isPinned ? "Remove offline download" : "Download for offline";
  const iconName = isWorking
    ? ("arrow-path" as const)
    : isDownloaded && isPinned
      ? ("check" as const)
      : ("download" as const);

  const toggleDownload = useCallback(
    async (event?: { preventDefault?: () => void; stopPropagation?: () => void }) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      if (!hasAudio) return;

      const storage = getOfflineStorage();
      setIsWorking(true);
      setIsBusy(true);

      try {
        if (isDownloaded && isPinned) {
          await storage.removeTrack(track.id);
          toast({ title: "Removed download", description: track.title });
        } else {
          await storage.downloadTrack(track, { pin: true, playlistId });
          toast({ title: "Downloaded for offline", description: track.title });
        }
        await refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Download failed";
        toast({ title: "Offline download failed", description: message, variant: "destructive" });
      } finally {
        setIsWorking(false);
        setIsBusy(false);
      }
    },
    [hasAudio, isDownloaded, isPinned, playlistId, refresh, setIsBusy, track],
  );

  return {
    hasAudio,
    isDownloaded,
    isPinned,
    isWorking,
    isBusy,
    label,
    iconName,
    toggleDownload,
  };
}
