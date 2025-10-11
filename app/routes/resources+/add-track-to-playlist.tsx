import { data } from 'react-router'
import type { Route } from './+types/add-track-to-playlist'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request)
  const formData = await request.formData()
  const trackId = String(formData.get('trackId'))
  const playlistId = String(formData.get('playlistId'))
  const forceDuplicate = formData.get('forceDuplicate') === 'true'
  
  // Verify playlist ownership
  const playlist = await prisma.userPlaylist.findFirst({
    where: { id: playlistId, ownerId: userId }
  })
  
  if (!playlist) {
    return data({ status: 'error', message: 'Playlist not found' }, { status: 404 })
  }
  
  // Check if track already exists in playlist (only if not forcing duplicate)
  if (!forceDuplicate) {
    const existing = await prisma.userPlaylistTrack.findFirst({
      where: { 
        playlistId, 
        trackId 
      }
    })
    
    if (existing) {
      return data({ 
        status: 'duplicate',
        message: 'Track already in playlist',
        playlistId,
        playlistTitle: playlist.title
      })
    }
  }
  
  // Get max position
  const maxPosition = await prisma.userPlaylistTrack.aggregate({
    where: { playlistId },
    _max: { position: true }
  })
  
  // Add track
  await prisma.userPlaylistTrack.create({
    data: {
      playlistId,
      trackId,
      position: (maxPosition._max.position ?? -1) + 1
    }
  })
  
  return data({ 
    status: 'success',
    message: `Added to "${playlist.title}"`
  })
}
