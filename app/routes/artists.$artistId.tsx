import { data, Link } from 'react-router'
import { Breadcrumbs, type BreadcrumbHandle } from '#app/components/breadcrumbs.tsx'
import { OfflineRouteBlocker } from '#app/components/offline/offline-route-blocker.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { getArtistTitle } from '#app/utils/breadcrumb-utils.ts'
import { prisma } from '#app/utils/db.server.ts'
import { formatDuration } from '#app/utils/format-duration.ts'
import { type Route } from './+types/artists.$artistId.ts'

export const handle: BreadcrumbHandle = {
  breadcrumb: ({ loaderData }) => getArtistTitle(loaderData),
}

export async function loader({ params }: Route.LoaderArgs) {
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
        orderBy: { year: 'asc' },
      },
      tracks: {
        select: {
          id: true,
          title: true,
          duration: true,
          albumRecord: {
            select: { id: true, name: true },
          },
          coverImage: { select: { objectKey: true } },
          audioFiles: {
            select: { id: true, format: true, objectKey: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      },
    },
  })

  if (!artist) {
    throw new Response('Artist not found', { status: 404 })
  }

  return data({ artist })
}

export default function ArtistRoute({ loaderData }: Route.ComponentProps) {
  const { artist } = loaderData

  return (
    <OfflineRouteBlocker>
    <div className="py-8">
      <Breadcrumbs />

      {/* Artist header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-6">
        {artist.imageUrl ? (
          <img
            src={artist.imageUrl}
            alt={artist.name}
            className="h-48 w-48 rounded-full object-cover shadow-lg"
          />
        ) : (
          <div className="flex h-48 w-48 items-center justify-center rounded-full bg-muted shadow-lg">
            <Icon name="file-text" className="h-16 w-16 text-muted-foreground" />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">Artist</p>
          <h1 className="text-4xl font-bold">{artist.name}</h1>
          {artist.genre && (
            <p className="text-sm text-muted-foreground">{artist.genre}</p>
          )}
          {artist.bio && (
            <p className="mt-2 max-w-prose text-sm text-muted-foreground">{artist.bio}</p>
          )}
        </div>
      </div>

      {/* Albums section */}
      {artist.albums.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-4 text-xl font-semibold">
            Albums ({artist.albums.length})
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {artist.albums.map((album) => (
              <Link
                key={album.id}
                to={`/albums/${album.id}`}
                className="group rounded-lg p-3 transition-colors hover:bg-muted/50"
              >
                {album.coverImage ? (
                  <img
                    src={`/resources/images/${album.coverImage.objectKey}`}
                    alt={album.name}
                    className="mb-2 aspect-square w-full rounded-md object-cover shadow-sm"
                    loading="lazy"
                  />
                ) : (
                  <div className="mb-2 flex aspect-square w-full items-center justify-center rounded-md bg-muted shadow-sm">
                    <Icon name="file-text" className="h-10 w-10 text-muted-foreground" />
                  </div>
                )}
                <p className="truncate text-sm font-medium group-hover:underline">
                  {album.name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {album.year ?? '—'} · {album._count.tracks} track{album._count.tracks !== 1 ? 's' : ''}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Tracks section */}
      {artist.tracks.length > 0 && (
        <section>
          <h2 className="mb-4 text-xl font-semibold">
            Tracks ({artist.tracks.length})
          </h2>
          <div className="space-y-1">
            {artist.tracks.map((track) => (
              <Link
                key={track.id}
                to={`/library/${track.id}`}
                className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted/50"
              >
                <span className="w-8 text-center text-sm text-muted-foreground">
                  <Icon name="file-text" className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{track.title}</p>
                  {track.albumRecord ? (
                    <p className="truncate text-xs text-muted-foreground">
                      {track.albumRecord.name}
                    </p>
                  ) : null}
                </div>
                {track.duration && (
                  <span className="text-xs text-muted-foreground">
                    {formatDuration(track.duration)}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {artist.albums.length === 0 && artist.tracks.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Icon name="file-text" className="mb-4 h-12 w-12 text-muted-foreground" />
          <p className="text-muted-foreground">No albums or tracks yet.</p>
        </div>
      )}
    </div>
    </OfflineRouteBlocker>
  )
}
