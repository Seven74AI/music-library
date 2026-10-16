/**
 * Album page inside the party-room shell. Playable tracks only.
 */

import { Link, useLoaderData, useLocation } from "react-router";
import { GeneralErrorBoundary } from "#app/components/error-boundary.tsx";
import { RoomBrowseBackLink } from "#app/components/party-room/room-browse-back-link.tsx";
import { RoomCatalogTrackRow } from "#app/components/party-room/room-catalog-track-row.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { readRoomSearchReturn, roomArtistHref } from "#app/features/party-room/room-browse.ts";
import {
  loadRoomAlbum,
  requireRoomCatalogSeat,
} from "#app/features/party-room/room-catalog.server.ts";
import { coverImageUrl } from "#app/utils/cover-image-url.ts";

const COVER_SIZE = 256;

export async function loader({
  request,
  params,
}: {
  request: Request;
  params: { code?: string; albumId?: string };
}) {
  const seat = await requireRoomCatalogSeat(request, params.code ?? "");
  const album = await loadRoomAlbum(params.albumId ?? "");
  if (!album) {
    throw new Response("Album not found", { status: 404 });
  }
  return { code: seat.code, album };
}

export default function RoomAlbumPage() {
  const { code, album } = useLoaderData<typeof loader>();
  const location = useLocation();
  const returnState = readRoomSearchReturn(location.state);
  const cover = coverImageUrl(album.coverObjectKey, COVER_SIZE);

  return (
    <div className="space-y-6">
      <RoomBrowseBackLink code={code} />
      <header className="flex items-end gap-4">
        {cover ? (
          <img
            src={cover}
            alt=""
            className="h-28 w-28 shrink-0 rounded-md object-cover shadow-sm"
          />
        ) : (
          <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-md bg-muted">
            <Icon name="camera" className="h-10 w-10 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Album</p>
          <h1 className="truncate text-2xl font-semibold tracking-tight">{album.name}</h1>
          <p className="truncate text-sm text-muted-foreground">
            <Link
              to={roomArtistHref(code, album.artist.id)}
              state={returnState}
              className="font-medium text-foreground hover:underline"
            >
              {album.artist.name}
            </Link>
            {album.year ? ` · ${album.year}` : ""}
            {` · ${album.tracks.length} track${album.tracks.length === 1 ? "" : "s"}`}
          </p>
        </div>
      </header>

      {album.tracks.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Tracks</h2>
          <ul className="space-y-1">
            {album.tracks.map((track) => (
              <RoomCatalogTrackRow
                key={track.id}
                track={track}
                showAlbum={false}
                returnState={returnState}
              />
            ))}
          </ul>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">No playable tracks in this album.</p>
      )}
    </div>
  );
}

export function ErrorBoundary() {
  return <GeneralErrorBoundary />;
}
