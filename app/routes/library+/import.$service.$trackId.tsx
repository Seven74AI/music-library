import { createId } from '@paralleldrive/cuid2'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { redirectWithToast } from '#app/utils/toast.server.ts'
import { getYouTubeVideoDetails, YouTubeAPIError } from '#app/utils/youtube-search.server.ts'
import { type Route } from './+types/import.$service.$trackId.ts'

export async function action({ request, params }: Route.ActionArgs) {
	const userId = await requireUserId(request)
	
	// Get the service
	const service = await prisma.service.findUnique({
		where: { name: params.service }
	})
	
	if (!service) {
		throw new Response('Service not found', { status: 404 })
	}
	
	// Fetch real track data from YouTube API
	let trackData
	try {
		trackData = await getYouTubeVideoDetails(params.trackId)
	} catch (error) {
		console.error('Failed to fetch YouTube video details:', error)
		
		if (error instanceof YouTubeAPIError) {
			return redirectWithToast('/library/import', {
				title: 'Import Failed',
				description: error.message,
				type: 'error',
			})
		}
		
		return redirectWithToast('/library/import', {
			title: 'Import Failed',
			description: 'Could not fetch track details from YouTube.',
			type: 'error',
		})
	}
	
	try {
		// Check if track already exists globally
		let track = await prisma.track.findUnique({
			where: {
				serviceId_serviceProviderId: {
					serviceId: service.id,
					serviceProviderId: params.trackId
				}
			}
		})
		
		// If track doesn't exist, create it
		if (!track) {
			track = await prisma.track.create({
				data: {
					id: createId(),
					title: trackData.title,
					artist: trackData.artist,
					serviceId: service.id,
					serviceProviderId: params.trackId,
					serviceUrl: trackData.serviceUrl,
					duration: trackData.duration,
					thumbnailUrl: trackData.thumbnailUrl,
				}
			})
		}
		
		// Check if user already has this track
		const existingUserTrack = await prisma.userTrack.findUnique({
			where: {
				userId_trackId: {
					userId: userId,
					trackId: track.id
				}
			}
		})
		
		if (existingUserTrack) {
			return redirectWithToast('/library', {
				title: 'Track Already in Library',
				description: `"${track.title}" is already in your library.`,
				type: 'message'
			})
		}
		
		// Add track to user's library
		await prisma.userTrack.create({
			data: {
				id: createId(),
				userId: userId,
				trackId: track.id,
			}
		})
		
		return redirectWithToast('/library', {
			title: 'Track Imported!',
			description: `"${track.title}" by ${track.artist} has been added to your library.`,
			type: 'success'
		})
		
	} catch (error) {
		console.error('Error importing track:', error)
		return redirectWithToast('/library/import', {
			title: 'Import Failed',
			description: 'Failed to import track. Please try again.',
			type: 'error'
		})
	}
}
