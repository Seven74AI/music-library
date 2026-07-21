import { formatDistanceToNow } from "date-fns";
import { Await, Link } from "react-router";
import { useAudioPlayer } from "#app/components/audio-player-provider.tsx";
import { ArchivingBanner } from "#app/components/home/archiving-banner.tsx";
import { HomeRecentPlaylistRow } from "#app/components/home/home-recent-playlist-row.tsx";
import { HomeRecentTrackRow } from "#app/components/home/home-recent-track-row.tsx";
import { InstallAppHomePrompt } from "#app/components/pwa/install-app-home-prompt.tsx";
import { Button } from "#app/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#app/components/ui/card.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { type HomeListeningData } from "#app/utils/home.server.ts";

type ListeningHomeProps = HomeListeningData & {
  showArchivingBanner: boolean;
};

export function ListeningHome({
  showArchivingBanner,
  totalTracks,
  playableTracks,
  archivingCount,
  stats,
  recentTracks,
  recentPlaylists,
  youtubeData,
}: ListeningHomeProps) {
  const { playLibrary, isLoadingNext } = useAudioPlayer();
  const canPlayLibrary = playableTracks > 0;

  return (
    <main className="py-8">
      <InstallAppHomePrompt />
      {showArchivingBanner ? (
        <ArchivingBanner
          totalTracks={totalTracks}
          playableTracks={playableTracks}
          archivingCount={archivingCount}
        />
      ) : null}

      <div className="mb-10 text-center">
        <h1 className="text-3xl font-bold">Home</h1>
        <p className="text-muted-foreground mt-2">
          {canPlayLibrary
            ? "Pick up where you left off or play your whole library."
            : "Tracks are still archiving — check back soon."}
        </p>
        <Button
          size="lg"
          className="mt-6"
          disabled={!canPlayLibrary || isLoadingNext}
          onClick={() => void playLibrary()}
        >
          <Icon name="play" className="mr-2 h-5 w-5" />
          {isLoadingNext ? "Loading…" : "Play library"}
        </Button>
      </div>

      <section className="mb-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Recently added</h2>
          <Link to="/library" className="text-sm text-muted-foreground hover:underline">
            View all
          </Link>
        </div>
        <HomeRecentTrackRow recentTracks={recentTracks} />
      </section>

      <section className="mb-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Recent playlists</h2>
          <Link to="/playlists" className="text-sm text-muted-foreground hover:underline">
            View all
          </Link>
        </div>
        <HomeRecentPlaylistRow recentPlaylists={recentPlaylists} />
      </section>

      <section>
        <h2 className="mb-4 text-xl font-semibold">Overview</h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Tracks</CardTitle>
              <Icon name="file-text" className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalTracks}</div>
              <p className="text-xs text-muted-foreground">
                <Link to="/library" className="hover:underline">
                  View your library →
                </Link>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">My Playlists</CardTitle>
              <Icon name="file-text" className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalPlaylists}</div>
              <p className="text-xs text-muted-foreground">
                <Link to="/playlists" className="hover:underline">
                  Manage playlists →
                </Link>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">YouTube</CardTitle>
              <Icon name="link-2" className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <Await resolve={youtubeData}>
                {(resolvedYoutubeData) => (
                  <>
                    <div className="text-2xl font-bold">
                      {resolvedYoutubeData.hasYouTubeConnection ? "Connected" : "Not Connected"}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      <Link to="/music/services/youtube" className="hover:underline">
                        Manage YouTube →
                      </Link>
                    </p>
                  </>
                )}
              </Await>
            </CardContent>
          </Card>
        </div>

        <Await resolve={youtubeData}>
          {(resolvedYoutubeData) =>
            resolvedYoutubeData.youtubeStats ? (
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Icon name="link-2" className="h-5 w-5" />
                    YouTube Service
                  </CardTitle>
                  <CardDescription>Your YouTube playlists and sync status</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div>
                      <p className="text-sm text-muted-foreground">Synced Playlists</p>
                      <p className="text-2xl font-bold">
                        {resolvedYoutubeData.youtubeStats.totalPlaylists}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Last Sync</p>
                      <p className="text-lg">
                        {resolvedYoutubeData.youtubeStats.lastSync
                          ? formatDistanceToNow(resolvedYoutubeData.youtubeStats.lastSync, {
                              addSuffix: true,
                            })
                          : "Never"}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Status</p>
                      <p className="text-lg">
                        {resolvedYoutubeData.hasYouTubeConnection ? "Connected" : "Not Connected"}
                      </p>
                    </div>
                  </div>

                  {resolvedYoutubeData.youtubePlaylists.length > 0 ? (
                    <div className="mb-4 space-y-2">
                      <h4 className="font-medium">Recent YouTube Playlists</h4>
                      {resolvedYoutubeData.youtubePlaylists.map((playlist) => (
                        <div
                          key={playlist.id}
                          className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted/50"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{playlist.title}</p>
                            <p className="text-sm text-muted-foreground">
                              {playlist.itemCount} tracks
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="flex gap-2">
                    <Button asChild>
                      <Link to="/music/services/youtube">Manage YouTube</Link>
                    </Button>
                    {!resolvedYoutubeData.hasYouTubeConnection ? (
                      <Button asChild variant="outline">
                        <Link to="/music/services/youtube/auth">Connect YouTube</Link>
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ) : null
          }
        </Await>
      </section>
    </main>
  );
}
