import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { redirectWithToast } from '#app/utils/toast.server.ts'
import { type Route } from './+types/library.$trackId.remove.ts'

export async function action({ request, params }: Route.ActionArgs) {
	const userId = await requireUserId(request)
	const trackId = params.trackId

	if (!trackId) {
		return redirectWithToast('/library', {
			title: 'Error',
			description: 'No track ID provided.',
			type: 'error',
		})
	}

	try {
		// Check if the user has this track in their library
		const userTrack = await prisma.userTrack.findUnique({
			where: {
				userId_trackId: {
					userId: userId,
					trackId: trackId,
				},
			},
			include: {
				track: {
					select: {
						title: true,
						artist: true,
					},
				},
			},
		})

		if (!userTrack) {
			return redirectWithToast('/library', {
				title: 'Track Not Found',
				description: 'This track is not in your library.',
				type: 'error',
			})
		}

		// Remove the track from user's library
		await prisma.userTrack.delete({
			where: {
				id: userTrack.id,
			},
		})

		return redirectWithToast('/library', {
			title: 'Track Removed',
			description: `"${userTrack.track.title}" by ${userTrack.track.artist} has been removed from your library.`,
			type: 'success',
		})
	} catch (error) {
		console.error('Error removing track:', error)
		return redirectWithToast('/library', {
			title: 'Error',
			description: 'Failed to remove track. Please try again.',
			type: 'error',
		})
	}
}
