import { useCallback, useState } from "react";
import { data, Link } from "react-router";
import { type BreadcrumbHandle } from "#app/components/breadcrumbs.tsx";
import { OfflineRouteBlocker } from "#app/components/offline/offline-route-blocker.tsx";
import { Button } from "#app/components/ui/button.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { requireUserId } from "#app/utils/auth.server.ts";
import { getTrackTitle } from "#app/utils/breadcrumb-utils.ts";
import { prisma } from "#app/utils/db.server.ts";
import { triggerBrowserDownload } from "#app/utils/download.ts";
import { formatDuration } from "#app/utils/format-duration.ts";
import { type Route } from "./+types/library.$trackId.ts";

export const handle: BreadcrumbHandle = {
  breadcrumb: ({ loaderData }) => getTrackTitle(loaderData),
};

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireUserId(request);

  const trackRaw = await prisma.track.findUnique({
    where: { id: params.trackId },
    select: {
      id: true,
      title: true,
      artist: {
        select: {
          id: true,
          name: true,
        },
      },
      createdAt: true,
      updatedAt: true,
      duration: true,
      coverImage: {
        select: {
          objectKey: true,
        },
      },
      audioFiles: {
        select: {
          id: true,
          format: true,
          objectKey: true,
          fileSize: true,
          bitrate: true,
          sampleRate: true,
        },
      },
    },
  });

  if (!trackRaw) {
    throw new Response("Track not found", { status: 404 });
  }

  // Return track with relations (no transformations needed)
  return data({ track: trackRaw });
}

export default function TrackRoute({ loaderData }: Route.ComponentProps) {
  const { track } = loaderData;
  const [isDownloading, setIsDownloading] = useState(false);
  const hasAudioFiles = track.audioFiles.length > 0;

  const handleDownload = useCallback(async () => {
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
    } finally {
      setIsDownloading(false);
    }
  }, [track.id]);

  return (
    <OfflineRouteBlocker>
      <div className="py-8">
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Icon name="file-text" className="text-muted-foreground" />
              <h2 className="text-h2">{track.title}</h2>
            </div>
            <Button asChild variant="outline">
              <Link to="/library">
                <Icon name="arrow-left" className="mr-2" />
                Back
              </Link>
            </Button>
          </div>
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <h3 className="text-lg font-semibold mb-2">Track Information</h3>
                <div className="space-y-2">
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">Title:</span>
                    <p className="text-base">{track.title}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">Artist:</span>
                    <p className="text-base">{track.artist.name}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">Duration:</span>
                    <p className="text-base">
                      {track.duration ? (
                        formatDuration(track.duration)
                      ) : (
                        <span className="text-muted-foreground flex items-center gap-1">
                          <Icon name="clock" className="h-4 w-4" />
                          Unknown
                        </span>
                      )}
                    </p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">Added:</span>
                    <p className="text-base">{new Date(track.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
              </div>

              {hasAudioFiles && (
                <div>
                  <h3 className="text-lg font-semibold mb-2">Audio Files</h3>
                  <div className="space-y-2">
                    {track.audioFiles.map((file) => (
                      <div key={file.id} className="flex items-center gap-2 text-sm">
                        <Icon name="file-text" className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">
                          {file.format?.toUpperCase() || "Unknown"}
                          {file.bitrate ? ` · ${file.bitrate}kbps` : ""}
                          {file.sampleRate ? ` · ${(file.sampleRate / 1000).toFixed(1)}kHz` : ""}
                          {file.fileSize ? ` · ${(file.fileSize / 1024 / 1024).toFixed(1)}MB` : ""}
                        </span>
                      </div>
                    ))}
                    <div className="pt-2">
                      <Button variant="default" onClick={handleDownload} disabled={isDownloading}>
                        <Icon
                          name={isDownloading ? "arrow-path" : "download"}
                          className={`mr-2 h-4 w-4 ${isDownloading ? "animate-spin" : ""}`}
                        />
                        {isDownloading ? "Preparing download..." : "Download"}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </OfflineRouteBlocker>
  );
}
