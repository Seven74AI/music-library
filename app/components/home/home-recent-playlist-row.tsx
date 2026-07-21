import { Link } from "react-router";
import { PlaylistCard } from "#app/components/playlist-card.tsx";
import { Button } from "#app/components/ui/button.tsx";
import { type HomeRecentPlaylist } from "#app/utils/home.server.ts";

type HomeRecentPlaylistRowProps = {
  recentPlaylists: HomeRecentPlaylist[];
};

export function HomeRecentPlaylistRow({ recentPlaylists }: HomeRecentPlaylistRowProps) {
  if (recentPlaylists.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border py-8 text-center">
        <p>No playlists yet</p>
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link to="/playlists/new">Create your first playlist</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-2 snap-x snap-mandatory">
      {recentPlaylists.map((playlist) => (
        <div key={playlist.id} className="w-56 shrink-0 snap-start sm:w-64">
          <PlaylistCard
            id={playlist.id}
            to={`/playlists/${playlist.id}`}
            title={playlist.title}
            description={playlist.description}
            tracks={playlist.tracks.map((playlistTrack) => playlistTrack.track)}
            createdAt={playlist.createdAt.toISOString()}
            updatedAt={playlist.updatedAt.toISOString()}
          />
        </div>
      ))}
    </div>
  );
}
