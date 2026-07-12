// @context7: React Router, Prisma, AWS S3
import { type LoaderFunctionArgs } from 'react-router'
import { selectBestAudioFile } from '#app/domain/audio-format.ts'
import { requireUserId } from '#app/utils/auth.server'
import { prisma } from '#app/utils/db.server'
import { getFileUrl } from '#app/utils/storage.server'

export async function loader({ request, params }: LoaderFunctionArgs) {
	const userId = await requireUserId(request)
	const trackId = params.trackId

	if (!trackId) {
		throw new Response('Track ID is required', { status: 400 })
	}

	// Get track with audio files
	const track = await prisma.track.findUnique({
		where: { id: trackId },
		include: {
			audioFiles: true,
			artist: {
				select: { name: true },
			},
			userTracks: {
				where: { userId, isActive: true, deletedAt: null },
				select: { id: true },
			},
		servicePlaylistTracks: {
			where: {
				isDeleted: false,
				deletedAt: null,
				playlist: { ownerId: userId, isActive: true },
			},
			take: 1,
		},
		},
	})

	if (!track) {
		throw new Response('Track not found', { status: 404 })
	}

	// Check if user has access to this track (must be in their library or a user-owned active service playlist)
	if (track.userTracks.length === 0 && track.servicePlaylistTracks.length === 0) {
		throw new Response('Access denied', { status: 403 })
	}

	// Get best available audio file
	const audioFile = selectBestAudioFile(track.audioFiles)

	if (!audioFile) {
		throw new Response('No audio file available for this track', { status: 404 })
	}

	if (!audioFile.objectKey) {
		throw new Response('Audio file object key not found', { status: 500 })
	}

	// Generate presigned URL (1 hour expiry)
	// In MOCKS mode, return a mock URL
	let url: string
	if (process.env.MOCKS === 'true') {
		const bucket = process.env.BUCKET_NAME || 'mock-bucket'
		url = `https://${bucket}.fly.storage.tigris.dev/${audioFile.objectKey}?presigned=true&expires=3600`
	} else {
		const result = await getFileUrl(audioFile.objectKey, 3600)
		url = result.url
	}

	// Build a friendly download filename
	const format = audioFile.format || 'mp3'
	const safeTitle = track.title.replace(/[^a-zA-Z0-9\u00C0-\u024F]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'track'
	const fileName = `${safeTitle} - ${track.artist.name.replace(/[^a-zA-Z0-9\u00C0-\u024F]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')}.${format}`

	return Response.json({
		url,
		fileName,
		mimeType: audioFile.mimeType || `audio/${format}`,
		format,
	})
}
