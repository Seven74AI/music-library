import { useEffect, useRef, useState } from "react";
import { data, useFetcher } from "react-router";
import { AlbumCard } from "#app/components/album-card.tsx";
import { Breadcrumbs, type BreadcrumbHandle } from "#app/components/breadcrumbs.tsx";
import { InfiniteScrollSentinel } from "#app/components/infinite-scroll-sentinel.tsx";
import { MusicEntityHeader } from "#app/components/music-entity-header.tsx";
import { OfflineRouteBlocker } from "#app/components/offline/offline-route-blocker.tsx";
import { TrackListItem } from "#app/components/track-list-item.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { getArtistTracksPage } from "#app/features/artist/artist-tracks.server.ts";
import { getUserId } from "#app/utils/auth.server.ts";
import { getArtistTitle } from "#app/utils/breadcrumb-utils.ts";
import { prisma } from "#app/utils/db.server.ts";
import { loadUserPlaylists } from "#app/utils/track-list-loader.server.ts";
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
      _count: { select: { tracks: true } },
    },
  });

  if (!artist) {
    throw new Response("Artist not found", { status: 404 });
  }

  const { _count, ...artistData } = artist;

  const [{ tracks, pagination }, playlists] = await Promise.all([
    getArtistTracksPage(userId, params.artistId),
    loadUserPlaylists(userId),
  ]);

  return data({
    artist: { ...artistData, trackCount: _count.tracks },
    initialTracks: tracks,
    pagination,
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

type ArtistTrack = Route.ComponentProps["loaderData"]["initialTracks"][number];

type ArtistTracksResponse = {
  tracks: ArtistTrack[];
  pagination: { limit: number; hasNext: boolean; nextCursor: string | null };
};

export default function ArtistRoute({ loaderData }: Route.ComponentProps) {
  const { artist, initialTracks, pagination: initialPagination, playlists } = loaderData;

  const fetcher = useFetcher<ArtistTracksResponse>();
  const [tracks, setTracks] = useState(initialTracks);
  const [pagination, setPagination] = useState(initialPagination);
  const requestedArtistRef = useRef<string | null>(null);

  // Reset the accumulated list whenever navigation re-runs the loader with a
  // fresh page 1 (e.g. navigating to a different artist).
  useEffect(() => {
    setTracks(initialTracks);
    setPagination(initialPagination);
  }, [initialTracks, initialPagination]);

  // Append the next page once the fetcher finishes, skipping any response that
  // was in flight for a different artist when the route changed.
  useEffect(() => {
    const next = fetcher.data;
    if (!next || requestedArtistRef.current !== artist.id) return;
    setTracks((prev) => {
      const seen = new Set(prev.map((track) => track.id));
      return [...prev, ...next.tracks.filter((track) => !seen.has(track.id))];
    });
    setPagination(next.pagination);
  }, [fetcher.data, artist.id]);

  const isLoading = fetcher.state !== "idle";

  const handleLoadMore = () => {
    if (isLoading || !pagination.hasNext || !pagination.nextCursor) return;
    requestedArtistRef.current = artist.id;
    const params = new URLSearchParams({
      artistId: artist.id,
      cursor: pagination.nextCursor,
      limit: String(pagination.limit),
    });
    fetcher.load(`/api/artist-tracks?${params.toString()}`);
  };

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
              <span>{formatArtistSummary(artist.albums.length, artist.trackCount)}</span>
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

        {tracks.length > 0 ? (
          <section>
            <h2 className="mb-4 text-xl font-semibold">Tracks ({artist.trackCount})</h2>
            <div role="grid" aria-label={`Tracks by ${artist.name}`}>
              {tracks.map((track, index) => (
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
                  playlistContext={{ type: "artist", artistId: artist.id }}
                  usePlaybackIndex={false}
                  showDuration
                />
              ))}
            </div>

            {(pagination.hasNext || isLoading) && (
              <InfiniteScrollSentinel
                enabled={pagination.hasNext && !isLoading}
                onIntersect={handleLoadMore}
                className="flex items-center justify-center py-8"
              >
                {isLoading ? (
                  <Icon name="update" className="h-6 w-6 animate-spin text-muted-foreground" />
                ) : (
                  <span className="text-sm text-muted-foreground">Scroll to load more</span>
                )}
              </InfiniteScrollSentinel>
            )}
          </section>
        ) : null}

        {artist.albums.length === 0 && artist.trackCount === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Icon name="avatar" className="mb-4 h-12 w-12 text-muted-foreground" />
            <p className="text-muted-foreground">No albums or tracks yet.</p>
          </div>
        ) : null}
      </div>
    </OfflineRouteBlocker>
  );
}
