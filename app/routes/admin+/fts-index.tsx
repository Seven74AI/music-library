import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { data, Form, useActionData, useLoaderData, useNavigation } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithRole } from '#app/utils/permissions.server.ts'
import { type Route } from './+types/fts-index.ts'

export const handle: SEOHandle = {
  getSitemapEntries: () => null,
}

interface FtsCounts {
  tracks: number
  albums: number
  artists: number
}

interface EntityCounts {
  tracks: number
  albums: number
  artists: number
}

interface LoaderData {
  fts: FtsCounts
  entities: EntityCounts
}

export async function loader({ request }: Route.LoaderArgs): Promise<LoaderData> {
  await requireUserWithRole(request, 'admin')

  const [tracksFts, albumsFts, artistsFts] = await Promise.all([
    prisma.$queryRawUnsafe<[{ count: bigint }]>(
      'SELECT COUNT(*) as count FROM tracks_fts',
    ),
    prisma.$queryRawUnsafe<[{ count: bigint }]>(
      'SELECT COUNT(*) as count FROM albums_fts',
    ),
    prisma.$queryRawUnsafe<[{ count: bigint }]>(
      'SELECT COUNT(*) as count FROM artists_fts',
    ),
  ])

  const [trackCount, albumCount, artistCount] = await Promise.all([
    prisma.track.count(),
    prisma.album.count(),
    prisma.artist.count(),
  ])

  return {
    fts: {
      tracks: Number(tracksFts[0].count),
      albums: Number(albumsFts[0].count),
      artists: Number(artistsFts[0].count),
    },
    entities: {
      tracks: trackCount,
      albums: albumCount,
      artists: artistCount,
    },
  }
}

export async function action({ request }: Route.ActionArgs) {
  await requireUserWithRole(request, 'admin')

  const formData = await request.formData()
  const entity = formData.get('entity') as string | null

  const rebuildTable: Record<string, string> = {
    tracks: 'tracks_fts',
    albums: 'albums_fts',
    artists: 'artists_fts',
  }

  if (entity === 'all') {
    try {
      await prisma.$executeRawUnsafe(`INSERT INTO tracks_fts(tracks_fts) VALUES('rebuild')`)
      await prisma.$executeRawUnsafe(`INSERT INTO albums_fts(albums_fts) VALUES('rebuild')`)
      await prisma.$executeRawUnsafe(`INSERT INTO artists_fts(artists_fts) VALUES('rebuild')`)
      return data({ message: `FTS indexes rebuilt for all entities` })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return data({ error: `Rebuild failed: ${msg}` })
    }
  }

  const table = rebuildTable[entity ?? '']
  if (!table) {
    return data({ error: `Unknown entity: ${entity}` })
  }

  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO ${table}(${table}) VALUES('rebuild')`,
    )
    return data({ message: `FTS index rebuilt for: ${entity}` })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return data({ error: `Rebuild failed: ${msg}` })
  }
}

export default function FtsIndexPage({ loaderData }: Route.ComponentProps) {
  const { fts, entities } = loaderData
  const actionData = useActionData<{ message?: string; error?: string }>()
  const navigation = useNavigation()

  const isRebuilding = (entity: string) =>
    navigation.state === 'submitting' &&
    navigation.formData?.get('entity') === entity

  const ftsHealthy = (entity: keyof FtsCounts) =>
    fts[entity] >= entities[entity] && entities[entity] > 0

  return (
    <div className="py-8">
      <h1 className="mb-2 text-2xl font-bold">FTS5 Index Management</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Rebuild FTS5 full-text search indexes when search results are stale or
        missing.
      </p>

      {actionData?.message && (
        <div className="mb-6 rounded-lg border border-green-500/50 bg-green-50/95 p-4 text-green-900 dark:bg-green-900/20 dark:text-green-100">
          <div className="flex items-center gap-2">
            <Icon name="check" className="h-5 w-5" />
            <span className="font-medium">{actionData.message}</span>
          </div>
        </div>
      )}

      {actionData?.error && (
        <div className="mb-6 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
          <div className="flex items-center gap-2">
            <Icon name="cross-1" className="h-5 w-5" />
            <span className="font-medium">{actionData.error}</span>
          </div>
        </div>
      )}

      {/* Summary table */}
      <div className="mb-8 overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-medium">Entity</th>
              <th className="px-4 py-3 text-right font-medium">FTS Rows</th>
              <th className="px-4 py-3 text-right font-medium">DB Rows</th>
              <th className="px-4 py-3 text-center font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {(['tracks', 'albums', 'artists'] as const).map((entity) => (
              <tr key={entity} className="border-b last:border-0">
                <td className="px-4 py-3 font-medium capitalize">{entity}</td>
                <td className="px-4 py-3 text-right font-mono">
                  {fts[entity].toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right font-mono">
                  {entities[entity].toLocaleString()}
                </td>
                <td className="px-4 py-3 text-center">
                  {ftsHealthy(entity) ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-300">
                      <Icon name="check" className="h-3 w-3" />
                      Healthy
                    </span>
                  ) : entities[entity] === 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      Empty
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300">
                      <Icon name="arrow-path" className="h-3 w-3" />
                      Stale
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <Form method="post">
                    <input type="hidden" name="entity" value={entity} />
                    <Button
                      type="submit"
                      variant="outline"
                      size="sm"
                      disabled={isRebuilding(entity)}
                    >
                      {isRebuilding(entity) ? (
                        <>
                          <Icon name="arrow-path" className="mr-1 h-3 w-3 animate-spin" />
                          Rebuilding…
                        </>
                      ) : (
                        'Rebuild'
                      )}
                    </Button>
                  </Form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Rebuild All */}
      <div className="rounded-lg border p-6">
        <h2 className="mb-2 text-lg font-semibold">Rebuild All Indexes</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Rebuilds tracks, albums, and artists FTS5 indexes in sequence.
        </p>
        <Form method="post">
          <input type="hidden" name="entity" value="all" />
          <Button
            type="submit"
            variant="default"
            disabled={isRebuilding('all')}
          >
            {isRebuilding('all') ? (
              <>
                <Icon name="arrow-path" className="mr-2 h-4 w-4 animate-spin" />
                Rebuilding All…
              </>
            ) : (
              <>
                <Icon name="arrow-path" className="mr-2 h-4 w-4" />
                Rebuild All Indexes
              </>
            )}
          </Button>
        </Form>
      </div>
    </div>
  )
}
