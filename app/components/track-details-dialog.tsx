import { useFetcher } from "react-router";
import { useEffect } from "react";
import { TrackThumbnail } from "#app/components/track-thumbnail";
import { Button } from "#app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#app/components/ui/dialog";
import { Icon } from "#app/components/ui/icon";
import { formatDuration } from "#app/utils/format-duration";

export interface TrackDetails {
  id: string;
  title: string;
  artist: { id: string; name: string };
  duration: number | null;
  createdAt: string;
  coverImage: { objectKey: string } | null;
  service: { displayName: string } | null;
  serviceUrl: string | null;
}

interface TrackDetailsDialogProps {
  trackId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TrackDetailsDialog({ trackId, open, onOpenChange }: TrackDetailsDialogProps) {
  const fetcher = useFetcher<{ track: TrackDetails }>();

  useEffect(() => {
    if (open && fetcher.state === "idle" && !fetcher.data) {
      fetcher.load(`/resources/track-details?trackId=${encodeURIComponent(trackId)}`);
    }
  }, [open, trackId, fetcher]);

  const track = fetcher.data?.track;
  const isLoading = fetcher.state !== "idle";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {isLoading ? (
          <>
            <div className="flex items-center justify-center py-12">
              <Icon name="update" className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
            <DialogDescription className="sr-only">Loading track details...</DialogDescription>
          </>
        ) : !track ? (
          <>
            <div className="py-8 text-center text-sm text-muted-foreground">
              Unable to load track details
            </div>
            <DialogDescription className="sr-only">Failed to load track details</DialogDescription>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-left">
                <div className="flex items-center gap-3">
                  <TrackThumbnail coverImage={track.coverImage} alt={track.title} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium" title={track.title}>
                      {track.title}
                    </div>
                    <div
                      className="truncate text-xs text-muted-foreground"
                      title={track.artist.name}
                    >
                      {track.artist.name}
                    </div>
                  </div>
                </div>
              </DialogTitle>
            </DialogHeader>
            <div className="mt-6 space-y-4">
              <div className="space-y-2">
                <div className="text-sm font-medium">Track Information</div>
                <div className="space-y-1 text-sm text-muted-foreground">
                  <div>Artist: {track.artist.name}</div>
                  <div>Duration: {formatDuration(track.duration)}</div>
                  <div>Added: {new Date(track.createdAt).toLocaleDateString()}</div>
                  {track.service?.displayName && <div>Source: {track.service.displayName}</div>}
                </div>
              </div>
              {track.serviceUrl && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(track.serviceUrl!, "_blank")}
                    className="flex-1"
                  >
                    <Icon name="link-2" className="mr-2 h-4 w-4" />
                    Open on YouTube
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
