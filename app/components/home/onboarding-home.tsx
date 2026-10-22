import { Link } from "react-router";
import { GotACodeJoin } from "#app/components/party-room/got-a-code-join.tsx";
import { InstallAppHomePrompt } from "#app/components/pwa/install-app-home-prompt.tsx";
import { Button } from "#app/components/ui/button.tsx";
import { Icon } from "#app/components/ui/icon.tsx";

type OnboardingHomeProps = {
  youtubeConnected: boolean;
  isAdmin: boolean;
};

export function OnboardingHome({ youtubeConnected, isAdmin }: OnboardingHomeProps) {
  const primaryHref = youtubeConnected
    ? "/music/services/youtube/playlists"
    : "/music/services/youtube/auth";
  const primaryLabel = youtubeConnected ? "Sync a playlist" : "Connect YouTube";

  return (
    <main className="py-12">
      <div className="mx-auto max-w-lg">
        <InstallAppHomePrompt />
        <GotACodeJoin className="mb-10" />
        <div className="text-center">
          <h1 className="text-3xl font-bold">Welcome to your music library</h1>
          <p className="text-muted-foreground mt-3">
            {youtubeConnected
              ? "Choose a YouTube playlist to start building your library."
              : "Connect YouTube to import playlists and archive your music."}
          </p>
          <Button asChild size="lg" className="mt-8">
            <Link to={primaryHref}>
              <Icon name="link-2" className="mr-2 h-4 w-4" />
              {primaryLabel}
            </Link>
          </Button>
          <div className="mt-8 border-t pt-8">
            <p className="text-muted-foreground mb-4 text-sm">or</p>
            <Button asChild variant="outline" size="lg">
              <Link to="/discover">
                <Icon name="globe" className="mr-2 h-4 w-4" />
                Explore Global Library
              </Link>
            </Button>
            <p className="text-muted-foreground mt-3 text-sm">
              Browse popular tracks from our community catalog
            </p>
          </div>
          {isAdmin ? (
            <div className="mt-10 border-t pt-8">
              <p className="text-muted-foreground mb-4 text-sm">or</p>
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
                <Button asChild variant="outline">
                  <Link to="/music/services/local/upload">
                    <Icon name="plus" className="mr-2 h-4 w-4" />
                    Upload your files
                  </Link>
                </Button>
              </div>
              <p className="text-muted-foreground mt-6 text-sm">
                You can also search for tracks from Search.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
