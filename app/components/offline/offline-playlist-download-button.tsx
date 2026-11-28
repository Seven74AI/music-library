import { useEffect, useState } from "react";
import { Button } from "#app/components/ui/button.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { toast } from "#app/components/ui/use-toast.ts";
import {
  cachePlaylistMetadata,
  getCachedPlaylistMetadata,
} from "#app/features/offline-storage/offline-playlist-metadata.client.ts";
import { getOfflineStorage } from "#app/features/offline-storage/offline-storage.client.ts";
import { useOfflinePlaylistDownloadStatus } from "#app/hooks/use-offline-playlist-download-status.ts";
import { type FullTrack } from "#app/types/frontend/shared";
import { filterPlayableTracks } from "#app/utils/playable-track.ts";

type OfflinePlaylistDownloadButtonProps = {
  playlistId: string;
  title: string;
  description: string | null;
  tracks: FullTrack[];
};

export function OfflinePlaylistDownloadButton({
  playlistId,
  title,
  description,
  tracks,
}: OfflinePlaylistDownloadButtonProps) {
  const [isWorking, setIsWorking] = useState(false);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const playableTracks = filterPlayableTracks(tracks);

  const { phase, status, refresh } = useOfflinePlaylistDownloadStatus(
    playlistId,
    playableTracks.map((track) => track.id),
  );
  const missingTracks = playableTracks.filter((track) => status.missingIds.has(track.id));
  const isComplete = phase === "ready" && status.isComplete;

  // Self-heal the offline index entry when everything is already on the device
  // (e.g. localStorage was cleared). Preserve updatedAt so ordering is stable.
  useEffect(() => {
    if (!isComplete) return;
    const existing = getCachedPlaylistMetadata(playlistId);
    if (existing && existing.title === title && existing.description === description) return;
    cachePlaylistMetadata({
      id: playlistId,
      title,
      description,
      updatedAt: existing?.updatedAt ?? Date.now(),
    });
  }, [isComplete, playlistId, title, description]);

  if (playableTracks.length === 0) return null;

  async function handleDownload() {
    if (isWorking || phase !== "ready" || missingTracks.length === 0) return;
    setIsWorking(true);
    const storage = getOfflineStorage();

    try {
      let downloaded = 0;
      const failures: string[] = [];
      for (const track of missingTracks) {
        try {
          await storage.downloadTrack(track, { pin: true, playlistId });
          downloaded += 1;
        } catch (error) {
          failures.push(
            error instanceof Error ? error.message : track.title || track.id,
          );
        }
        setProgress({ completed: downloaded, total: missingTracks.length });
      }

      if (downloaded === missingTracks.length) {
        // Only register the playlist in the offline index once every track is
        // actually pinned — a fully-failed download must not show as available.
        cachePlaylistMetadata({
          id: playlistId,
          title,
          description,
          updatedAt: Date.now(),
        });
        toast({
          title: "Playlist downloaded",
          description: `${downloaded} track${downloaded === 1 ? "" : "s"} saved for offline listening.`,
        });
      } else if (downloaded > 0) {
        toast({
          title: "Playlist partially downloaded",
          description: `${downloaded} of ${missingTracks.length} tracks saved. ${failures.length} failed.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Playlist download failed",
          description: failures[0] ?? "Download failed",
          variant: "destructive",
        });
      }
    } finally {
      await refresh();
      setIsWorking(false);
      setProgress(null);
    }
  }

  const label =
    isWorking && progress
      ? `Downloading ${progress.completed}/${progress.total}`
      : isComplete
        ? "Downloaded"
        : phase === "ready" && status.isPartial
          ? `Download ${missingTracks.length} missing track${missingTracks.length === 1 ? "" : "s"}`
          : "Download playlist";
  const iconName = isWorking ? "arrow-path" : isComplete ? "check" : "download";

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => void handleDownload()}
      disabled={isWorking || phase === "checking" || isComplete}
      aria-label={label}
    >
      <Icon
        name={iconName}
        className={`mr-2 h-4 w-4 ${isWorking ? "animate-spin" : ""}`}
      />
      {label}
    </Button>
  );
}
