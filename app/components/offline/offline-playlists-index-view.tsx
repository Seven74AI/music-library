import { Link } from "react-router";
import { Button } from "#app/components/ui/button.tsx";
import { type CachedPlaylistMeta } from "#app/features/offline-storage/offline-playlist-metadata.client.ts";

type OfflinePlaylistsIndexViewProps = {
  playlists: Array<CachedPlaylistMeta & { trackCount: number }>;
};

export function OfflinePlaylistsIndexView({ playlists }: OfflinePlaylistsIndexViewProps) {
  if (playlists.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center">
        <p className="text-muted-foreground">
          No playlists with downloaded tracks yet. Download a playlist while online to listen
          offline.
        </p>
        <Button asChild className="mt-4">
          <Link to="/downloads">Open downloads</Link>
        </Button>
      </div>
    );
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {playlists.map((playlist) => (
        <li key={playlist.id}>
          <Link
            to={`/playlists/${playlist.id}`}
            className="hover:bg-muted/50 block rounded-lg border p-4 transition-colors"
          >
            <h2 className="font-semibold">{playlist.title}</h2>
            {playlist.description ? (
              <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
                {playlist.description}
              </p>
            ) : null}
            <p className="text-muted-foreground mt-3 text-sm">
              {playlist.trackCount} downloaded track
              {playlist.trackCount === 1 ? "" : "s"}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
