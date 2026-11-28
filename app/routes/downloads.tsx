import { useCallback, useEffect, useState } from "react";
import { Link, useRevalidator } from "react-router";
import { OfflineLibraryView } from "#app/components/offline/offline-library-view.tsx";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "#app/components/ui/alert-dialog.tsx";
import { Button } from "#app/components/ui/button.tsx";
import { Checkbox } from "#app/components/ui/checkbox.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { Label } from "#app/components/ui/label.tsx";
import { toast } from "#app/components/ui/use-toast.ts";
import { type DownloadsOfflineLoaderData } from "#app/features/offline-app/offline-route-policies.client.ts";
import { getOfflineStorage } from "#app/features/offline-storage/offline-storage.client.ts";
import { isQueueOnlyOfflineTrack } from "#app/features/offline-storage/pin-policy.ts";
import {
  isQueueCacheEnabled,
  setQueueCacheEnabled,
} from "#app/features/offline-storage/queue-cache-preference.client.ts";
import { useOptionalUser } from "#app/utils/user.ts";

export async function clientLoader(): Promise<DownloadsOfflineLoaderData> {
  const storage = getOfflineStorage();
  const [tracks, stats] = await Promise.all([storage.listDownloaded(), storage.getStorageStats()]);
  return { tracks, stats };
}

export default function DownloadsRoute({
  loaderData,
}: {
  loaderData: DownloadsOfflineLoaderData | undefined;
}) {
  const revalidator = useRevalidator();
  const user = useOptionalUser();
  const userId = user?.id ?? "";
  const [queueCacheEnabled, setQueueCacheEnabledState] = useState(true);
  const [isPurging, setIsPurging] = useState(false);
  const [purgeDialogOpen, setPurgeDialogOpen] = useState(false);
  const [isPromoting, setIsPromoting] = useState(false);
  const [promoteDialogOpen, setPromoteDialogOpen] = useState(false);

  const handleOfflineDownloadChange = useCallback(() => {
    revalidator.revalidate();
  }, [revalidator]);

  useEffect(() => {
    if (!userId) return;
    setQueueCacheEnabledState(isQueueCacheEnabled(userId));
  }, [userId]);

  if (!loaderData) return null;
  const { tracks, stats } = loaderData;
  const usedMb = (stats.totalBytes / (1024 * 1024)).toFixed(1);
  const quotaMb = stats.quota ? (stats.quota / (1024 * 1024)).toFixed(0) : null;
  const queueOnlyTracks = tracks.filter(isQueueOnlyOfflineTrack);
  const queueOnlyCount = queueOnlyTracks.length;
  const downloadedCount = tracks.filter((track) => track.isPinned).length;
  const queueOnlyBytes = queueOnlyTracks.reduce((sum, track) => sum + track.fileSizeBytes, 0);
  const queueOnlyMb = (queueOnlyBytes / (1024 * 1024)).toFixed(1);

  function handleQueueCacheToggle(checked: boolean | "indeterminate") {
    if (!userId || checked === "indeterminate") return;
    setQueueCacheEnabled(userId, checked);
    setQueueCacheEnabledState(checked);
  }

  async function handlePurgeQueueCache() {
    setIsPurging(true);
    try {
      const { removedCount } = await getOfflineStorage().purgeQueueCache();
      toast({
        title: "Cleared auto-cached tracks",
        description:
          removedCount === 0
            ? "No auto-cached tracks to remove."
            : `Removed ${removedCount} auto-cached track${removedCount === 1 ? "" : "s"}.`,
      });
      setPurgeDialogOpen(false);
      revalidator.revalidate();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to clear auto-cached tracks";
      toast({ title: "Clear failed", description: message, variant: "destructive" });
    } finally {
      setIsPurging(false);
    }
  }

  async function handlePinQueueCachedTracks() {
    setIsPromoting(true);
    try {
      const { promotedCount } = await getOfflineStorage().pinQueueCachedTracks();
      toast({
        title: promotedCount === 0 ? "Nothing to download" : `Downloaded ${promotedCount} tracks`,
        description:
          promotedCount === 0
            ? "No auto-cached tracks were ready to promote."
            : `${promotedCount} auto-cached track${promotedCount === 1 ? "" : "s"} are now saved as downloads.`,
      });
      setPromoteDialogOpen(false);
      revalidator.revalidate();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Download failed";
      toast({ title: "Download failed", description: message, variant: "destructive" });
    } finally {
      setIsPromoting(false);
    }
  }

  return (
    <main className="py-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Downloads</h1>
          <p className="text-muted-foreground mt-2">
            {downloadedCount} downloaded · {queueOnlyCount} auto-cached · {usedMb} MB
            {quotaMb ? ` of ~${quotaMb} MB` : ""} on this device.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void revalidator.revalidate()}>
          <Icon name="arrow-path" className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {userId ? (
        <div className="mb-6 flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Checkbox
              id="queue-cache-enabled"
              checked={queueCacheEnabled}
              onCheckedChange={handleQueueCacheToggle}
            />
            <div className="space-y-1">
              <Label htmlFor="queue-cache-enabled" className="cursor-pointer font-medium">
                Auto-cache queue tracks{" "}
                <span className="text-muted-foreground font-normal">
                  ({queueCacheEnabled ? "On" : "Off"})
                </span>
              </Label>
              <p className="text-muted-foreground text-sm">
                While you listen online, save the current track and the upcoming queue on this
                device so playback keeps going. Turning this off stops new auto-caching. Your
                downloads are never removed automatically, and tracks already auto-cached stay until
                you clear them.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <AlertDialog open={promoteDialogOpen} onOpenChange={setPromoteDialogOpen}>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={queueOnlyCount === 0 || isPromoting}
                >
                  Download all auto-cached
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Download {queueOnlyCount} auto-cached track{queueOnlyCount === 1 ? "" : "s"}?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    This keeps {queueOnlyCount} track{queueOnlyCount === 1 ? "" : "s"} (
                    {queueOnlyMb} MB) on this device. They won&apos;t be cleared automatically —
                    remove them from the list when you no longer need them.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isPromoting}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={isPromoting}
                    onClick={(event) => {
                      event.preventDefault();
                      void handlePinQueueCachedTracks();
                    }}
                  >
                    Download all
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={purgeDialogOpen} onOpenChange={setPurgeDialogOpen}>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={queueOnlyCount === 0 || isPurging}
                >
                  Clear auto-cached tracks
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear auto-cached tracks?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes {queueOnlyCount} auto-cached track
                    {queueOnlyCount === 1 ? "" : "s"} from this device. Your downloaded tracks are
                    kept.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isPurging}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={isPurging}
                    onClick={(event) => {
                      event.preventDefault();
                      void handlePurgeQueueCache();
                    }}
                  >
                    Clear auto-cached tracks
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      ) : null}

      {tracks.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-muted-foreground">
            No offline tracks yet. Download tracks from your library or playlists while online.
          </p>
          <Button asChild className="mt-4">
            <Link to="/library">Browse library</Link>
          </Button>
        </div>
      ) : (
        <OfflineLibraryView
          tracks={tracks}
          showStorageBadge
          playContextType="downloads"
          onOfflineDownloadChange={handleOfflineDownloadChange}
        />
      )}
    </main>
  );
}
