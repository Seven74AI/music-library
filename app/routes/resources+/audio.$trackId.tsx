// @context7: React Router, Prisma, AWS S3
import { readFileSync, existsSync, statSync, openSync, readSync, closeSync } from 'fs'
import { join } from 'path'
import { type LoaderFunctionArgs, redirect } from 'react-router'
import { getBestAudioFile } from '#app/utils/audio-file-selection.server'
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
			userTracks: {
				where: { userId },
				select: { id: true },
			},
		},
	})

	if (!track) {
		throw new Response('Track not found', { status: 404 })
	}

	// Check if user has access to this track (must be in their library)
	if (track.userTracks.length === 0) {
		throw new Response('Access denied', { status: 403 })
	}

	// Get best available audio file
	const audioFile = getBestAudioFile(track.audioFiles)

	if (!audioFile) {
		throw new Response('No audio file available for this track', { status: 404 })
	}

	if (!audioFile.objectKey) {
		throw new Response('Audio file object key not found', { status: 500 })
	}

	// Check if file exists locally (for development)
	const localFilePath = join(process.cwd(), 'tests', 'fixtures', 'uploaded', audioFile.objectKey)
	if (existsSync(localFilePath)) {
		const mimeType = audioFile.mimeType || 'audio/flac'
		const fileStats = statSync(localFilePath)
		const fileSize = fileStats.size
		
		// Check for Range header to support seeking
		const rangeHeader = request.headers.get('Range')
		
		if (rangeHeader) {
			// Parse range header (e.g., "bytes=0-1023" or "bytes=1024-")
			const rangeMatch = rangeHeader.match(/bytes=(\d+)-(\d*)/)
			if (rangeMatch && rangeMatch[1]) {
				const start = parseInt(rangeMatch[1], 10)
				const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : fileSize - 1
				const chunkSize = end - start + 1
				
				// Validate range
				if (start >= 0 && start < fileSize && end < fileSize && start <= end) {
					// Read only the requested byte range
					const fileBuffer = Buffer.allocUnsafe(chunkSize)
					const fd = openSync(localFilePath, 'r')
					readSync(fd, fileBuffer, 0, chunkSize, start)
					closeSync(fd)
					
					// Return 206 Partial Content
					return new Response(fileBuffer, {
						status: 206,
						headers: {
							'Content-Type': mimeType,
							'Content-Length': chunkSize.toString(),
							'Content-Range': `bytes ${start}-${end}/${fileSize}`,
							'Accept-Ranges': 'bytes',
							'Cache-Control': 'public, max-age=3600',
						},
					})
				}
			}
		}
		
		// No range request or invalid range - serve full file
		// But include Accept-Ranges header so browser knows we support ranges
		const fileBuffer = readFileSync(localFilePath)
		
		return new Response(fileBuffer, {
			headers: {
				'Content-Type': mimeType,
				'Content-Length': fileSize.toString(),
				'Accept-Ranges': 'bytes',
				'Cache-Control': 'public, max-age=3600',
			},
		})
	}

	// Generate signed URL for remote storage (Tigris/S3)
	// Use longer expiry for audio files (1 hour)
	const { url } = await getFileUrl(audioFile.objectKey, 3600)

	// Redirect to signed URL
	return redirect(url)
}

