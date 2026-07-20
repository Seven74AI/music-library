import { data, Link } from 'react-router'
import { Breadcrumbs, type BreadcrumbHandle } from '#app/components/breadcrumbs.tsx'
import { OfflineRouteBlocker } from '#app/components/offline/offline-route-blocker.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { getAlbumTitle } from '#app/utils/breadcrumb-utils.ts'
import { prisma } from '#app/utils/db.server.ts'
import { formatDuration } from '#app/utils/format-duration.ts'
import { type Route } from './+types/albums.$albumId.ts'

export const handle: BreadcrumbHandle = {
  breadcrumb: ({ loaderData }) => getAlbumTitle(loaderData),
}

export async function loader({ params }: Route.LoaderArgs) {
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
          artist: {
            select: { id: true, name: true },
          },
          coverImage: { select: { objectKey: true } },
          audioFiles: {
            select: { id: true, format: true, objectKey: true },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!album) {
    throw new Response('Album not found', { status: 404 })
  }

  return data({ album })
}

export default function AlbumRoute({ loaderData }: Route.ComponentProps) {
  const { album } = loaderData

  return (
    <OfflineRouteBlocker>
    <div className="py-8">
      <Breadcrumbs />

      {/* Album header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-6">
        {album.coverImage ? (
          <img
            src={`/resources/images/${album.coverImage.objectKey}`}
            alt={album.name}
            className="h-48 w-48 rounded-md object-cover shadow-lg"
          />
        ) : (
          <div className="flex h-48 w-48 items-center justify-center rounded-md bg-muted shadow-lg">
            <Icon name="file-text" className="h-16 w-16 text-muted-foreground" />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">Album</p>
          <h1 className="text-4xl font-bold">{album.name}</h1>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link
              to={`/artists/${album.artist.id}`}
              className="font-medium text-foreground hover:underline"
            >
              {album.artist.name}
            </Link>
            {album.year && <span>· {album.year}</span>}
            <span>· {album.tracks.length} track{album.tracks.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
      </div>

      {/* Tracks */}
      {album.tracks.length > 0 ? (
        <section>
          <div className="space-y-1">
            {album.tracks.map((track, i) => (
              <Link
                key={track.id}
                to={`/library/${track.id}`}
                className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted/50"
              >
                <span className="w-8 text-center text-sm text-muted-foreground">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{track.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {track.artist.name}
                  </p>
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
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Icon name="file-text" className="mb-4 h-12 w-12 text-muted-foreground" />
          <p className="text-muted-foreground">No tracks in this album yet.</p>
        </div>
      )}
    </div>
    </OfflineRouteBlocker>
  )
}
