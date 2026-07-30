import { Link, useRevalidator } from "react-router";
import { OfflineLibraryView } from "#app/components/offline/offline-library-view.tsx";
import { Button } from "#app/components/ui/button.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { getOfflineStorage } from "#app/features/offline-storage/offline-storage.client.ts";
import { type DownloadsOfflineLoaderData } from "#app/features/offline-app/offline-route-policies.client.ts";

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
  if (!loaderData) return null;
  const { tracks, stats } = loaderData;
  const usedMb = (stats.totalBytes / (1024 * 1024)).toFixed(1);
  const quotaMb = stats.quota ? (stats.quota / (1024 * 1024)).toFixed(0) : null;

  return (
    <main className="py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Downloads</h1>
          <p className="text-muted-foreground mt-2">
            {stats.pinnedCount} pinned · {stats.trackCount} total cached · {usedMb} MB
            {quotaMb ? ` of ~${quotaMb} MB` : ""} on this device.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void revalidator.revalidate()}>
          <Icon name="arrow-path" className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

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
        <OfflineLibraryView tracks={tracks} />
      )}
    </main>
  );
}
