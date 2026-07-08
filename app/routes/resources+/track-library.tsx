import { data } from 'react-router'
import { requireUserId } from '#app/utils/auth.server.ts'
import { createServicePlaylistService } from '#app/utils/service-playlist.server'
import { createToastHeaders } from '#app/utils/toast.server.ts'
import { type Route } from './+types/track-library'

/**
 * Resource route for adding/removing tracks to/from the user's personal library.
 * 
 * POST /resources/track-library
 * Body: trackId (string), action ("add" | "remove")
 */
export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request)
  const formData = await request.formData()

  const trackId = formData.get('trackId')
  const actionType = formData.get('action')

  if (typeof trackId !== 'string' || !trackId) {
    return data(
      { status: 'error', message: 'Invalid track ID' },
      {
        status: 400,
        headers: await createToastHeaders({
          title: 'Error',
          description: 'Invalid track ID provided',
          type: 'error',
        }),
      },
    )
  }

  if (actionType !== 'add' && actionType !== 'remove') {
    return data(
      { status: 'error', message: 'Invalid action' },
      {
        status: 400,
        headers: await createToastHeaders({
          title: 'Error',
          description: 'Invalid action. Must be "add" or "remove".',
          type: 'error',
        }),
      },
    )
  }

  try {
    const service = createServicePlaylistService()

    if (actionType === 'add') {
      const result = await service.addTrackToUserLibrary(trackId, userId)
      if (!result.success) {
        return data(
          { status: 'error', message: result.message },
          {
            status: 500,
            headers: await createToastHeaders({
              title: 'Error',
              description: result.message,
              type: 'error',
            }),
          },
        )
      }
      return data(
        { status: 'success', message: result.message },
        {
          headers: await createToastHeaders({
            title: 'Added to Library',
            description: 'Track has been added to your library.',
            type: 'success',
          }),
        },
      )
    }

    // actionType === 'remove'
    const result = await service.removeTrackFromUserLibrary(trackId, userId)
    if (!result.success) {
      return data(
        { status: 'error', message: result.message },
        {
          status: 404,
          headers: await createToastHeaders({
            title: 'Error',
            description: result.message,
            type: 'error',
          }),
        },
      )
    }
    return data(
      { status: 'success', message: result.message },
      {
        headers: await createToastHeaders({
          title: 'Removed from Library',
          description: 'Track has been removed from your library.',
          type: 'success',
        }),
      },
    )
  } catch (error) {
    console.error('Error in track-library action:', error)
    return data(
      { status: 'error', message: 'Internal server error' },
      {
        status: 500,
        headers: await createToastHeaders({
          title: 'Error',
          description: 'Failed to update library. Please try again.',
          type: 'error',
        }),
      },
    )
  }
}
