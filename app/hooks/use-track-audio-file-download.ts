import { useCallback, useState } from "react";
import { toast } from "#app/components/ui/use-toast.ts";
import { triggerBrowserDownload } from "#app/utils/download.ts";

/**
 * Browser download of the track's audio file (save to disk), matching the
 * player and track-detail download actions — not offline/PWA pinning.
 */
export function useTrackAudioFileDownload(track: { id: string; title: string } | null) {
  const [isDownloading, setIsDownloading] = useState(false);

  const downloadAudioFile = useCallback(async () => {
    if (!track) return;
    setIsDownloading(true);
    try {
      const response = await fetch(`/resources/audio/${track.id}/download-url`);
      if (!response.ok) {
        throw new Error(`Failed to get download URL: ${response.status}`);
      }
      const { fileName } = (await response.json()) as { fileName: string };
      await triggerBrowserDownload(`/resources/audio/${track.id}?stream=1`, fileName);
    } catch (error) {
      console.error("Download failed:", error);
      toast({
        title: "Download failed",
        description: error instanceof Error ? error.message : "Could not download track",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  }, [track]);

  return {
    isDownloading,
    downloadAudioFile,
    label: isDownloading ? "Downloading…" : "Download",
  };
}
