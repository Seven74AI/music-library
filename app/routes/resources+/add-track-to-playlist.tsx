import { data } from 'react-router'
import { requireUserId } from '#app/utils/auth.server.ts'
import { createToastHeaders } from '#app/utils/toast.server.ts'
import { addTrackToUserPlaylist } from '#app/utils/user-playlist.server.ts'
import  { type Route } from './+types/add-track-to-playlist'

/**
 * Server action for adding a track to a playlist
 * Handles validation, duplicate checking, and position assignment
 * Returns appropriate toast notifications for success/error states
 * 
 * @param request - HTTP request containing form data
 * @returns Response with status and toast headers
 */
export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request)
  const formData = await request.formData()
  
  // Safe form data extraction with validation
  const trackId = formData.get('trackId')
  const playlistId = formData.get('playlistId')
  const forceDuplicate = formData.get('forceDuplicate') === 'true'
  
  if (typeof trackId !== 'string' || typeof playlistId !== 'string') {
    return data(
      { status: 'error', message: 'Invalid form data' },
      {
        status: 400,
        headers: await createToastHeaders({
          title: 'Error',
          description: 'Invalid form data provided',
          type: 'error',
        }),
      }
    )
  }
  
  try {
    const result = await addTrackToUserPlaylist({
      userId,
      playlistId,
      trackId,
      forceDuplicate,
    })

    if (result.status === 'not_found') {
      return data(
        { status: 'error', message: 'Playlist not found' },
        {
          status: 404,
          headers: await createToastHeaders({
            title: 'Error',
            description: 'Playlist not found',
            type: 'error',
          }),
        }
      )
    }

    if (result.status === 'duplicate') {
      return data(
        { 
          status: 'duplicate',
          message: 'Track already in playlist',
          playlistId: result.playlistId,
          playlistTitle: result.playlistTitle,
        },
        {
          headers: await createToastHeaders({
            title: 'Duplicate Track',
            description: `Track is already in "${result.playlistTitle}"`,
            type: 'message',
          }),
        }
      )
    }
    
    return data(
      { 
        status: 'success',
        message: `Added to "${result.playlistTitle}"`
      },
      {
        headers: await createToastHeaders({
          title: 'Success',
          description: `Track added to "${result.playlistTitle}"`,
          type: 'success',
        }),
      }
    )
  } catch (error) {
    console.error('Error adding track to playlist:', error)
    return data(
      { status: 'error', message: 'Internal server error' },
      {
        status: 500,
        headers: await createToastHeaders({
          title: 'Error',
          description: 'Failed to add track to playlist',
          type: 'error',
        }),
      }
    )
  }
}
