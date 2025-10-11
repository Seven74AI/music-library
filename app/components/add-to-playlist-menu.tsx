import { useState, useMemo, useCallback, useEffect } from 'react'
import { useFetcher } from 'react-router'
import { toast } from 'sonner'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog'
import { Input } from './ui/input'
import { ScrollArea } from './ui/scroll-area'

interface Playlist {
  id: string
  title: string
  description: string | null
  _count: { tracks: number }
}

interface AddToPlaylistMenuProps {
  trackId: string
  trackTitle: string
  playlists: Playlist[]
  onSuccess?: () => void
}

/**
 * Component for adding a track to a playlist with search functionality
 * Supports both dropdown (desktop) and sheet (mobile) contexts
 * 
 * @param trackId - ID of the track to add
 * @param trackTitle - Title of the track for display
 * @param playlists - Array of available playlists
 * @param onSuccess - Optional callback when track is successfully added (used to close sheets on mobile)
 * 
 * @example
 * ```tsx
 * <AddToPlaylistMenu 
 *   trackId="track-123" 
 *   trackTitle="Song Title"
 *   playlists={userPlaylists}
 *   onSuccess={() => setIsSheetOpen(false)}
 * />
 * ```
 */
export function AddToPlaylistMenu({ trackId, trackTitle, playlists, onSuccess }: AddToPlaylistMenuProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [duplicatePlaylist, setDuplicatePlaylist] = useState<Playlist | null>(null)
  const fetcher = useFetcher<{ status: string; message?: string; playlistId?: string }>()
  
  // Filter playlists by search query
  const filteredPlaylists = useMemo(() => {
    if (!searchQuery) return playlists
    return playlists.filter(p => 
      p.title.toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [playlists, searchQuery])
  
  // Handle add to playlist using React Router v7 fetcher
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

  // Handle responses using React Router v7 idiomatic pattern
  useEffect(() => {
    // Only process when fetcher transitions from submitting to idle
    if (fetcher.state === 'idle' && fetcher.data) {
      if (fetcher.data.status === 'success') {
        void toast.success(fetcher.data.message || 'Track added successfully')
        setDuplicatePlaylist(null)
        // Call onSuccess callback if provided (for closing sheets on mobile)
        if (onSuccess) {
          onSuccess()
        }
      } else if (fetcher.data.status === 'error') {
        void toast.error(fetcher.data.message || 'Failed to add track to playlist')
      } else if (fetcher.data.status === 'duplicate') {
        const playlist = playlists.find(p => p.id === fetcher.data?.playlistId)
        if (playlist) {
          setDuplicatePlaylist(playlist)
        }
      }
    }
  }, [fetcher.state, fetcher.data, playlists, onSuccess])
  
  return (
    <>
      <div className="w-full p-2" role="dialog" aria-label="Add to playlist">
        {/* Accessible search input */}
        <label htmlFor="playlist-search" className="sr-only">
          Search playlists
        </label>
        <Input
          id="playlist-search"
          placeholder="Search playlists..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="mb-2"
          autoFocus
          aria-describedby="playlist-count"
        />
        
        {/* Screen reader announcement for results count */}
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
                  disabled={fetcher.state !== 'idle'}
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
        
        {/* Loading state announcement for screen readers */}
        {fetcher.state !== 'idle' && (
          <div className="sr-only" role="status" aria-live="assertive">
            Adding track to playlist...
          </div>
        )}
      </div>
      
      {/* Duplicate confirmation dialog - Radix UI AlertDialog is already accessible */}
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
