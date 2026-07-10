import { useState, useMemo, useCallback, useEffect } from 'react'
import { useFetcher, useRevalidator } from 'react-router'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog'
import { Button } from './ui/button'
import { Icon } from './ui/icon'
import { Input } from './ui/input'
import { ScrollArea } from './ui/scroll-area'

/**
 * Playlist data structure for the add-to-playlist menu
 */
interface Playlist {
  id: string
  title: string
  description: string | null
  _count: { tracks: number }
}

type CreatePlaylistResponse = {
  status: string
  message?: string
  existingTitle?: string
  playlist?: Playlist
}

/**
 * Props for the AddToPlaylistMenu component
 */
interface AddToPlaylistMenuProps {
  /** ID of the track to add to playlist */
  trackId: string
  /** Title of the track for display purposes */
  trackTitle: string
  /** Array of available playlists to add the track to */
  playlists: Playlist[]
  /** Optional callback when track is successfully added (used to close sheets on mobile) */
  onSuccess?: () => void
}

/**
 * Component for adding a track to a playlist with search functionality
 * Supports both dropdown (desktop) and sheet (mobile) contexts
 */
export function AddToPlaylistMenu({ trackId, trackTitle, playlists, onSuccess }: AddToPlaylistMenuProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [duplicatePlaylist, setDuplicatePlaylist] = useState<Playlist | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [newPlaylistTitle, setNewPlaylistTitle] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [localPlaylists, setLocalPlaylists] = useState(playlists)
  const fetcher = useFetcher<{ status: string; message?: string; playlistId?: string }>()
  const createFetcher = useFetcher<CreatePlaylistResponse>()
  const { revalidate } = useRevalidator()

  useEffect(() => {
    setLocalPlaylists(playlists)
  }, [playlists])

  const filteredPlaylists = useMemo(() => {
    if (!searchQuery) return localPlaylists
    return localPlaylists.filter(p =>
      p.title.toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [localPlaylists, searchQuery])

  const handleAddToPlaylist = useCallback((playlist: Playlist, force = false) => {
    void fetcher.submit(
      {
        trackId,
        playlistId: playlist.id,
        forceDuplicate: force ? 'true' : 'false'
      },
      {
        method: 'POST',
        action: '/resources/add-track-to-playlist'
      }
    )
  }, [fetcher, trackId])

  const handleStartCreate = useCallback(() => {
    setIsCreating(true)
    setCreateError(null)
    setNewPlaylistTitle('')
  }, [])

  const handleCancelCreate = useCallback(() => {
    setIsCreating(false)
    setCreateError(null)
    setNewPlaylistTitle('')
  }, [])

  const handleCreatePlaylist = useCallback(() => {
    const title = newPlaylistTitle.trim()
    if (!title) {
      setCreateError('Playlist name is required')
      return
    }

    setCreateError(null)
    void createFetcher.submit(
      { title, trackId },
      {
        method: 'POST',
        action: '/resources/create-playlist-with-track',
      },
    )
  }, [createFetcher, newPlaylistTitle, trackId])

  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data) {
      if (fetcher.data.status === 'success') {
        setDuplicatePlaylist(null)
        if (onSuccess) {
          onSuccess()
        }
      } else if (fetcher.data.status === 'duplicate') {
        const playlist = localPlaylists.find(p => p.id === fetcher.data?.playlistId)
        if (playlist) {
          setDuplicatePlaylist(playlist)
        }
      }
    }
  }, [fetcher.state, fetcher.data, localPlaylists, onSuccess])

  useEffect(() => {
    if (createFetcher.state === 'idle' && createFetcher.data) {
      if (createFetcher.data.status === 'success' && createFetcher.data.playlist) {
        const playlist = createFetcher.data.playlist
        setLocalPlaylists((current) =>
          current.some((p) => p.id === playlist.id) ? current : [playlist, ...current],
        )
        setIsCreating(false)
        setNewPlaylistTitle('')
        setCreateError(null)
        void revalidate()
        if (onSuccess) {
          onSuccess()
        }
      } else if (createFetcher.data.status === 'duplicate_title') {
        setCreateError(
          createFetcher.data.message ??
            `You already have a playlist named "${createFetcher.data.existingTitle ?? 'this name'}"`,
        )
      } else if (createFetcher.data.status === 'invalid_title') {
        setCreateError('Playlist name is required')
      }
    }
  }, [createFetcher.state, createFetcher.data, onSuccess, revalidate])

  const isBusy = fetcher.state !== 'idle' || createFetcher.state !== 'idle'

  return (
    <>
      <div className="w-full p-2" role="dialog" aria-label="Add to playlist">
        <label htmlFor="playlist-search" className="sr-only">
          Search playlists
        </label>
        <Input
          id="playlist-search"
          placeholder="Search playlists..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="mb-2"
          autoFocus={!isCreating}
          aria-describedby="playlist-count"
        />

        <div id="playlist-count" className="sr-only">
          {filteredPlaylists.length} {filteredPlaylists.length === 1 ? 'playlist' : 'playlists'} available
        </div>

        <ScrollArea className="h-64">
          {filteredPlaylists.length === 0 ? (
            <div
              className="py-8 text-center text-sm text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              {searchQuery ? 'No playlists found' : 'No playlists yet'}
            </div>
          ) : (
            <div
              role="list"
              aria-label="Available playlists"
              className="space-y-1"
            >
              {filteredPlaylists.map((playlist) => (
                <button
                  key={playlist.id}
                  onClick={() => handleAddToPlaylist(playlist)}
                  disabled={isBusy}
                  role="listitem"
                  aria-label={`Add "${trackTitle}" to ${playlist.title}`}
                  aria-describedby={`playlist-info-${playlist.id}`}
                  className="w-full text-left px-2 py-2 rounded hover:bg-accent transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  <div className="font-medium text-sm">{playlist.title}</div>
                  <div
                    id={`playlist-info-${playlist.id}`}
                    className="text-xs text-muted-foreground"
                  >
                    {playlist._count.tracks} {playlist._count.tracks === 1 ? 'track' : 'tracks'}
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>

        <div className="mt-2 border-t pt-2">
          {isCreating ? (
            <div
              className="space-y-2"
              // Keep the Radix submenu open while focusing nested inputs; same pointerdown
              // family of workarounds as track-list-item handleMenuPointerDown.
              // See: https://github.com/radix-ui/primitives/issues/1242
              onPointerDown={(e) => e.preventDefault()}
            >
              <label htmlFor="new-playlist-title" className="sr-only">
                New playlist name
              </label>
              <Input
                id="new-playlist-title"
                placeholder="Playlist name"
                value={newPlaylistTitle}
                onChange={(e) => {
                  setNewPlaylistTitle(e.target.value)
                  setCreateError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleCreatePlaylist()
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    handleCancelCreate()
                  }
                }}
                autoFocus
                disabled={isBusy}
                aria-invalid={!!createError}
                aria-describedby={createError ? 'new-playlist-error' : undefined}
              />
              {createError && (
                <p id="new-playlist-error" className="text-xs text-destructive" role="alert">
                  {createError}
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="flex-1"
                  onClick={handleCreatePlaylist}
                  disabled={isBusy}
                >
                  <Icon name="check" className="h-4 w-4 mr-1" />
                  Create playlist
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleCancelCreate}
                  disabled={isBusy}
                  aria-label="Cancel new playlist"
                >
                  <Icon name="cross-1" className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleStartCreate}
              className="flex min-h-11 w-full items-center gap-2 rounded px-2 py-2 text-sm font-medium hover:bg-accent transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              <Icon name="plus" className="h-4 w-4" />
              New playlist
            </button>
          )}
        </div>

        {isBusy && (
          <div className="sr-only" role="status" aria-live="assertive">
            {createFetcher.state !== 'idle' ? 'Creating playlist...' : 'Adding track to playlist...'}
          </div>
        )}
      </div>

      <AlertDialog open={!!duplicatePlaylist} onOpenChange={() => setDuplicatePlaylist(null)}>
        <AlertDialogContent className="z-[9999]">
          <AlertDialogHeader>
            <AlertDialogTitle>Track already in playlist</AlertDialogTitle>
            <AlertDialogDescription>
              The track "{trackTitle}" is already in the playlist "{duplicatePlaylist?.title}".
              Do you want to add it again as a duplicate?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (duplicatePlaylist) {
                  void handleAddToPlaylist(duplicatePlaylist, true)
                }
              }}
            >
              Add Duplicate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
