/**
 * Artist page inside the party-room shell. Playable albums and tracks only.
 */

import { Link, useLoaderData, useLocation } from "react-router";
import { GeneralErrorBoundary } from "#app/components/error-boundary.tsx";
import { RoomBrowseBackLink } from "#app/components/party-room/room-browse-back-link.tsx";
import { RoomCatalogTrackRow } from "#app/components/party-room/room-catalog-track-row.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import {
  loadRoomArtist,
  requireRoomCatalogSeat,
} from "#app/features/party-room/room-catalog.server.ts";
import {
  readRoomSearchReturn,
  roomAlbumHref,
  roomArtistTrackNote,
} from "#app/features/party-room/room-browse.ts";
import { albumCardCoverPixelSize, coverImageUrl } from "#app/utils/cover-image-url.ts";

const COVER_SIZE = 256;

export async function loader({
  request,
  params,
}: {
  request: Request;
  params: { code?: string; artistId?: string };
}) {
  const seat = await requireRoomCatalogSeat(request, params.code ?? "");
  const artist = await loadRoomArtist(params.artistId ?? "");
  if (!artist) {
    throw new Response("Artist not found", { status: 404 });
  }
  return { code: seat.code, artist };
}

export default function RoomArtistPage() {
  const { code, artist } = useLoaderData<typeof loader>();
  const location = useLocation();
  const returnState = readRoomSearchReturn(location.state);
  const image = coverImageUrl(artist.imageObjectKey, COVER_SIZE);
  const note = roomArtistTrackNote(artist.tracks.length, artist.trackCount);

  return (
    <div className="space-y-6">
      <RoomBrowseBackLink code={code} />
      <header className="flex items-end gap-4">
        {image ? (
          <img
            src={image}
            alt=""
            className="h-28 w-28 shrink-0 rounded-full object-cover shadow-sm"
          />
        ) : (
          <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-full bg-muted">
            <Icon name="avatar" className="h-10 w-10 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Artist
          </p>
          <h1 className="truncate text-2xl font-semibold tracking-tight">{artist.name}</h1>
          <p className="truncate text-sm text-muted-foreground">
            {artist.genre ? `${artist.genre} · ` : ""}
            {artist.albums.length} album{artist.albums.length === 1 ? "" : "s"}
            {` · ${artist.trackCount} track${artist.trackCount === 1 ? "" : "s"}`}
          </p>
        </div>
      </header>

      {artist.albums.length > 0 ? (
        <section>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Albums</h2>
          <div className="grid grid-cols-2 gap-3">
            {artist.albums.map((album) => {
              const cover = coverImageUrl(album.coverObjectKey, albumCardCoverPixelSize);
              return (
                <Link
                  key={album.id}
                  to={roomAlbumHref(code, album.id)}
                  state={returnState}
                  className="rounded-lg p-2 hover:bg-muted/50"
                >
                  {cover ? (
                    <img
                      src={cover}
                      alt=""
                      className="mb-2 aspect-square w-full rounded-md object-cover"
                    />
                  ) : (
                    <div className="mb-2 flex aspect-square w-full items-center justify-center rounded-md bg-muted">
                      <Icon name="camera" className="h-8 w-8 text-muted-foreground" />
                    </div>
                  )}
                  <p className="truncate text-sm font-medium">{album.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {album.year ? `${album.year} · ` : ""}
                    {album.trackCount} track{album.trackCount === 1 ? "" : "s"}
                  </p>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {artist.tracks.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Tracks</h2>
          {note ? <p className="mb-2 text-xs text-muted-foreground">{note}</p> : null}
          <ul className="space-y-1">
            {artist.tracks.map((track) => (
              <RoomCatalogTrackRow key={track.id} track={track} returnState={returnState} />
            ))}
          </ul>
        </section>
      ) : null}

      {artist.albums.length === 0 && artist.tracks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No playable albums or tracks.</p>
      ) : null}
    </div>
  );
}

export function ErrorBoundary() {
  return <GeneralErrorBoundary />;
}
