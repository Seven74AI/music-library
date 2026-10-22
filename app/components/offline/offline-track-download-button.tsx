import { Button } from "#app/components/ui/button.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import {
  useOfflineTrackDownload,
  type OfflineDownloadTrack,
} from "#app/hooks/use-offline-track-download.ts";

type OfflineTrackDownloadButtonProps = {
  track: OfflineDownloadTrack;
  playlistId?: string;
  size?: "sm" | "icon";
};

export function OfflineTrackDownloadButton({
  track,
  playlistId,
  size = "icon",
}: OfflineTrackDownloadButtonProps) {
  const { hasAudio, isDownloaded, isPinned, isWorking, isBusy, label, iconName, toggleDownload } =
    useOfflineTrackDownload(track, playlistId);

  if (!hasAudio) return null;

  return (
    <Button
      type="button"
      size={size}
      variant={isDownloaded && isPinned ? "secondary" : "ghost"}
      onClick={(event) => void toggleDownload(event)}
      disabled={isWorking || isBusy}
      aria-label={label}
      title={label}
    >
      <Icon name={iconName} className={`h-4 w-4 ${isWorking ? "animate-spin" : ""}`} />
    </Button>
  );
}
