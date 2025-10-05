import { formatDistanceToNow } from 'date-fns'
import { data, redirect, Form, useActionData, useLoaderData, type LoaderFunctionArgs, type ActionFunctionArgs } from 'react-router'
import { Button } from '#app/components/ui/button'
import { Icon } from '#app/components/ui/icon'
import { requireUserId } from '#app/utils/auth.server'
import { createYouTubePlaylistService } from '#app/utils/youtube-playlist.server'

export async function loader({ request }: LoaderFunctionArgs) {
  const userId = await requireUserId(request)
  const youtubePlaylistService = createYouTubePlaylistService()
  
  const [playlists, syncStatus, hasConnection] = await Promise.all([
    youtubePlaylistService.getUserPlaylists(userId),
    youtubePlaylistService.getSyncStatus(userId),
    youtubePlaylistService.getStoredTokens(userId).then(tokens => !!tokens),
  ])

  return data({
    playlists,
    syncStatus,
    hasConnection,
  })
}

export async function action({ request }: ActionFunctionArgs) {
  const userId = await requireUserId(request)
  const formData = await request.formData()
  
  const intent = formData.get('intent')
  
  if (typeof intent !== 'string') {
    return data({ status: 'error', message: 'Invalid form data' }, { status: 400 })
  }

  const youtubePlaylistService = createYouTubePlaylistService()

  try {
    switch (intent) {
      case 'sync': {
        // Check if user already has YouTube tokens
        const playlistService = createYouTubePlaylistService()
        const storedTokens = await playlistService.getStoredTokens(userId)
        
        if (storedTokens) {
          // User has tokens, sync directly
          try {
            const result = await playlistService.syncUserPlaylists(userId)
            return data({ status: 'success', ...result })
          } catch {
            // If sync fails, redirect to re-authenticate
            return redirect('/youtube/auth')
          }
        } else {
          // No tokens, redirect to YouTube OAuth
          return redirect('/youtube/auth')
        }
      }
      
      case 'remove': {
        const playlistId = formData.get('playlistId')
        if (typeof playlistId !== 'string') {
          return data({ status: 'error', message: 'Playlist ID is required' }, { status: 400 })
        }
        
        const result = await youtubePlaylistService.removePlaylist(playlistId, userId)
        return data({ status: 'success', ...result })
      }
      
      default:
        return data({ status: 'error', message: 'Invalid action' })
    }
  } catch (error) {
    return data({
      status: 'error',
      message: error instanceof Error ? error.message : 'An error occurred',
    })
  }
}

export default function YouTubePlaylistsPage() {
  const { playlists, syncStatus, hasConnection } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()

  return (
    <div className="container mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">YouTube Playlists</h1>
        <p className="text-muted-foreground mt-2">
          Manage your synced YouTube playlists
        </p>
      </div>

      {/* Sync Status */}
      <div className="mb-6 rounded-lg border bg-card text-card-foreground shadow-sm">
        <div className="p-6">
          <h3 className="text-2xl font-semibold leading-none tracking-tight flex items-center gap-2 mb-4">
            <Icon name="update" className="h-5 w-5" />
            Sync Status
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Total Playlists</p>
              <p className="text-2xl font-bold">{syncStatus.totalPlaylists}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Last Sync</p>
              <p className="text-lg">
                {syncStatus.lastSync 
                  ? formatDistanceToNow(syncStatus.lastSync, { addSuffix: true })
                  : 'Never'
                }
              </p>
            </div>
            <div className="flex items-end">
              <Form method="post">
                <input type="hidden" name="intent" value="sync" />
                <Button type="submit">
                  <Icon name="update" className="h-4 w-4 mr-2" />
                  Sync Playlists
                </Button>
              </Form>
            </div>
          </div>
        </div>
      </div>

      {/* Action Messages */}
      {actionData?.status === 'error' && (
        <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
          <p className="text-destructive">{actionData.message}</p>
        </div>
      )}

      {actionData?.status === 'success' && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-green-800">{actionData.message}</p>
        </div>
      )}


      {/* Playlists Grid */}
      {playlists.length === 0 ? (
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="p-12 text-center">
            <div className="mx-auto w-24 h-24 bg-muted rounded-full flex items-center justify-center mb-4">
              <Icon name="link-2" className="h-12 w-12 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">
              {hasConnection ? 'No YouTube Playlists Found' : 'No YouTube Playlists'}
            </h3>
            <p className="text-muted-foreground mb-4">
              {hasConnection 
                ? 'You don\'t have any playlists in your YouTube account, or they haven\'t been synced yet.'
                : 'Connect your YouTube account to sync your playlists'
              }
            </p>
            <Form method="post">
              <input type="hidden" name="intent" value="sync" />
              <Button type="submit">
                {hasConnection ? 'Sync Playlists' : 'Connect YouTube Account'}
              </Button>
            </Form>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {playlists.map((playlist: any) => (
            <div key={playlist.id} className="rounded-lg border bg-card text-card-foreground shadow-sm overflow-hidden">
              <div className="p-6 pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-semibold leading-none tracking-tight overflow-hidden" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {playlist.title}
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1 overflow-hidden" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {playlist.description || 'No description'}
                    </p>
                  </div>
                  {playlist.thumbnailUrl && (
                    <img
                      src={playlist.thumbnailUrl}
                      alt={playlist.title}
                      className="w-16 h-16 rounded-lg object-cover ml-3 flex-shrink-0"
                    />
                  )}
                </div>
              </div>
              
              <div className="px-6 pb-6">
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Icon name="avatar" className="h-4 w-4" />
                    <span className="truncate">{playlist.channelTitle}</span>
                  </div>
                  
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Icon name="clock" className="h-4 w-4" />
                    <span>{playlist.itemCount} videos</span>
                  </div>
                  
                  {playlist.lastSyncedAt && (
                    <div className="text-xs text-muted-foreground">
                      Last synced: {formatDistanceToNow(playlist.lastSyncedAt, { addSuffix: true })}
                    </div>
                  )}
                  
                  <div className="h-[1px] w-full bg-border" />
                  
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors border-transparent bg-secondary text-secondary-foreground">
                      {playlist.isActive ? 'Active' : 'Inactive'}
                    </span>
                    
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(`https://youtube.com/playlist?list=${playlist.youtubeId}`, '_blank')}
                      >
                        <Icon name="link-2" className="h-4 w-4" />
                      </Button>
                      
                      <Form method="post" className="inline">
                        <input type="hidden" name="intent" value="remove" />
                        <input type="hidden" name="playlistId" value={playlist.id} />
                        <Button
                          type="submit"
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                        >
                          <Icon name="trash" className="h-4 w-4" />
                        </Button>
                      </Form>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
