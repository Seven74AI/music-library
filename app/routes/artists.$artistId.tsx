import { data } from "react-router";
import { AlbumCard } from "#app/components/album-card.tsx";
import { Breadcrumbs, type BreadcrumbHandle } from "#app/components/breadcrumbs.tsx";
import { MusicEntityHeader } from "#app/components/music-entity-header.tsx";
import { OfflineRouteBlocker } from "#app/components/offline/offline-route-blocker.tsx";
import { TrackListItem } from "#app/components/track-list-item.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { getUserId } from "#app/utils/auth.server.ts";
import { getArtistTitle } from "#app/utils/breadcrumb-utils.ts";
import { prisma } from "#app/utils/db.server.ts";
import {
  loadLibraryStatusByTrackId,
  loadUserPlaylists,
} from "#app/utils/track-list-loader.server.ts";
import { type Route } from "./+types/artists.$artistId.ts";

export const handle: BreadcrumbHandle = {
  breadcrumb: ({ loaderData }) => getArtistTitle(loaderData),
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const userId = await getUserId(request);

  const artist = await prisma.artist.findUnique({
    where: { id: params.artistId },
    select: {
      id: true,
      name: true,
      genre: true,
      bio: true,
      imageUrl: true,
      createdAt: true,
      albums: {
        select: {
          id: true,
          name: true,
          year: true,
          coverImage: { select: { objectKey: true } },
          _count: { select: { tracks: true } },
        },
        orderBy: { year: "asc" },
      },
      tracks: {
        select: {
          id: true,
          title: true,
          duration: true,
          createdAt: true,
          serviceUrl: true,
          albumRecord: {
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
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
  });

  if (!artist) {
    throw new Response("Artist not found", { status: 404 });
  }

  const trackIds = artist.tracks.map((track) => track.id);
  const [{ libraryTrackIds, userTrackCreatedAtByTrackId }, playlists] = await Promise.all([
    loadLibraryStatusByTrackId(userId, trackIds),
    loadUserPlaylists(userId),
  ]);

  const tracks = artist.tracks.map((track) => ({
    ...track,
    isInUserLibrary: libraryTrackIds.has(track.id),
    userTrackCreatedAt:
      userTrackCreatedAtByTrackId.get(track.id)?.toISOString() ?? track.createdAt.toISOString(),
  }));

  return data({
    artist: {
      ...artist,
      tracks,
    },
    playlists,
  });
}

function formatArtistSummary(albumCount: number, trackCount: number) {
  const parts = [
    `${albumCount} album${albumCount !== 1 ? "s" : ""}`,
    `${trackCount} track${trackCount !== 1 ? "s" : ""}`,
  ];
  return parts.join(" · ");
}

export default function ArtistRoute({ loaderData }: Route.ComponentProps) {
  const { artist, playlists } = loaderData;

  return (
    <OfflineRouteBlocker>
      <div className="py-8">
        <Breadcrumbs />

        <MusicEntityHeader
          label="Artist"
          title={artist.name}
          imageUrl={artist.imageUrl}
          imageShape="circle"
          fallbackIcon="avatar"
          metadata={
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {artist.genre ? <span>{artist.genre}</span> : null}
              {artist.genre ? <span aria-hidden="true">·</span> : null}
              <span>{formatArtistSummary(artist.albums.length, artist.tracks.length)}</span>
            </div>
          }
          description={artist.bio}
        />

        {artist.albums.length > 0 ? (
          <section className="mb-8">
            <h2 className="mb-4 text-xl font-semibold">Albums ({artist.albums.length})</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {artist.albums.map((album) => (
                <AlbumCard
                  key={album.id}
                  id={album.id}
                  name={album.name}
                  year={album.year}
                  trackCount={album._count.tracks}
                  coverObjectKey={album.coverImage?.objectKey}
                />
              ))}
            </div>
          </section>
        ) : null}

        {artist.tracks.length > 0 ? (
          <section>
            <h2 className="mb-4 text-xl font-semibold">Tracks ({artist.tracks.length})</h2>
            <div role="grid" aria-label={`Tracks by ${artist.name}`}>
              {artist.tracks.map((track, index) => (
                <TrackListItem
                  key={track.id}
                  track={{
                    id: track.id,
                    title: track.title,
                    artist: { id: artist.id, name: artist.name },
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
        ) : null}

        {artist.albums.length === 0 && artist.tracks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Icon name="avatar" className="mb-4 h-12 w-12 text-muted-foreground" />
            <p className="text-muted-foreground">No albums or tracks yet.</p>
          </div>
        ) : null}
      </div>
    </OfflineRouteBlocker>
  );
}
