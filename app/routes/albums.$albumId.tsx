import { data, Link } from "react-router";
import { Breadcrumbs, type BreadcrumbHandle } from "#app/components/breadcrumbs.tsx";
import { MusicEntityHeader } from "#app/components/music-entity-header.tsx";
import { OfflineRouteBlocker } from "#app/components/offline/offline-route-blocker.tsx";
import { TrackListItem } from "#app/components/track-list-item.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { getUserId } from "#app/utils/auth.server.ts";
import { getAlbumTitle } from "#app/utils/breadcrumb-utils.ts";
import { prisma } from "#app/utils/db.server.ts";
import {
  loadLibraryStatusByTrackId,
  loadUserPlaylists,
} from "#app/utils/track-list-loader.server.ts";
import { type Route } from "./+types/albums.$albumId.ts";

export const handle: BreadcrumbHandle = {
  breadcrumb: ({ loaderData }) => getAlbumTitle(loaderData),
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const userId = await getUserId(request);

  const album = await prisma.album.findUnique({
    where: { id: params.albumId },
    select: {
      id: true,
      name: true,
      year: true,
      createdAt: true,
      artist: {
        select: { id: true, name: true },
      },
      coverImage: { select: { objectKey: true } },
      tracks: {
        select: {
          id: true,
          title: true,
          duration: true,
          createdAt: true,
          serviceUrl: true,
          artist: {
            select: { id: true, name: true },
          },
          coverImage: { select: { objectKey: true } },
          service: {
            select: {
              displayName: true,
              logoUrl: true,
            },
          },
          audioFiles: {
            select: { id: true, format: true, objectKey: true },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!album) {
    throw new Response("Album not found", { status: 404 });
  }

  const trackIds = album.tracks.map((track) => track.id);
  const [{ libraryTrackIds, userTrackCreatedAtByTrackId }, playlists] = await Promise.all([
    loadLibraryStatusByTrackId(userId, trackIds),
    loadUserPlaylists(userId),
  ]);

  const tracks = album.tracks.map((track) => ({
    ...track,
    isInUserLibrary: libraryTrackIds.has(track.id),
    userTrackCreatedAt:
      userTrackCreatedAtByTrackId.get(track.id)?.toISOString() ?? track.createdAt.toISOString(),
  }));

  return data({
    album: {
      ...album,
      tracks,
    },
    playlists,
  });
}

export default function AlbumRoute({ loaderData }: Route.ComponentProps) {
  const { album, playlists } = loaderData;
  const coverImageUrl = album.coverImage ? `/resources/images/${album.coverImage.objectKey}` : null;

  return (
    <OfflineRouteBlocker>
      <div className="py-8">
        <Breadcrumbs />

        <MusicEntityHeader
          label="Album"
          title={album.name}
          imageUrl={coverImageUrl}
          fallbackIcon="camera"
          metadata={
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Link
                to={`/artists/${album.artist.id}`}
                className="font-medium text-foreground hover:underline"
              >
                {album.artist.name}
              </Link>
              {album.year ? <span aria-hidden="true">·</span> : null}
              {album.year ? <span>{album.year}</span> : null}
              <span aria-hidden="true">·</span>
              <span>
                {album.tracks.length} track{album.tracks.length !== 1 ? "s" : ""}
              </span>
            </div>
          }
        />

        {album.tracks.length > 0 ? (
          <section>
            <h2 className="mb-4 text-xl font-semibold">Tracks ({album.tracks.length})</h2>
            <div role="grid" aria-label={`Tracks from ${album.name}`}>
              {album.tracks.map((track, index) => (
                <TrackListItem
                  key={track.id}
                  track={{
                    id: track.id,
                    title: track.title,
                    artist: track.artist,
                    duration: track.duration,
                    coverImage: track.coverImage,
                    serviceUrl: track.serviceUrl,
                    service: track.service,
                    audioFiles: track.audioFiles,
                    isInUserLibrary: track.isInUserLibrary,
                  }}
                  userTrack={{ createdAt: track.userTrackCreatedAt }}
                  index={index}
                  playlists={playlists}
                  variant="compact"
                  showQuickAddToPlaylist
                  playlistContext={{ type: "library" }}
                  showDuration
                />
              ))}
            </div>
          </section>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Icon name="camera" className="mb-4 h-12 w-12 text-muted-foreground" />
            <p className="text-muted-foreground">No tracks in this album yet.</p>
          </div>
        )}
      </div>
    </OfflineRouteBlocker>
  );
}
