// @context7: React Router, Prisma, AWS S3
import { readFileSync, existsSync, statSync, openSync, readSync, closeSync } from 'fs'
import { join, resolve, sep } from 'path'
import { type LoaderFunctionArgs } from 'react-router'
import { selectBestAudioFile } from '#app/domain/audio-format.ts'
import { requireUserId } from '#app/utils/auth.server'
import { prisma } from '#app/utils/db.server'
import { getFileUrl, getStorageObjectStream } from '#app/utils/storage.server'

function serveLocalAudioFile(
	localFilePath: string,
	audioFile: { mimeType: string | null },
	request: Request,
) {
	const mimeType = audioFile.mimeType || 'audio/flac'
	const fileStats = statSync(localFilePath)
	const fileSize = fileStats.size

	const rangeHeader = request.headers.get('Range')

	if (rangeHeader) {
		const rangeMatch = rangeHeader.match(/bytes=(\d+)-(\d*)/)
		if (rangeMatch && rangeMatch[1]) {
			const start = parseInt(rangeMatch[1], 10)
			const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : fileSize - 1
			const chunkSize = end - start + 1

			if (start >= 0 && start < fileSize && end < fileSize && start <= end) {
				const fileBuffer = Buffer.allocUnsafe(chunkSize)
				const fd = openSync(localFilePath, 'r')
				readSync(fd, fileBuffer, 0, chunkSize, start)
				closeSync(fd)

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

export async function loader({ request, params, url }: LoaderFunctionArgs) {
	const userId = await requireUserId(request)
	const trackId = params.trackId

	if (!trackId) {
		throw new Response('Track ID is required', { status: 400 })
	}

	// Get track with audio files
	const track = await prisma.track.findUnique({
		where: { id: trackId },
		include: {
			audioFiles: {
				select: {
					id: true,
					format: true,
					objectKey: true,
					mimeType: true,
				},
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
			playlists: {
				where: {
					playlist: { ownerId: userId },
				},
				take: 1,
			},
		},
	})

	if (!track) {
		throw new Response('Track not found', { status: 404 })
	}

	// Check if user has access to this track (must be in their library, a user-owned active service playlist, or a user playlist)
	if (track.userTracks.length === 0 && track.servicePlaylistTracks.length === 0 && track.playlists.length === 0) {
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

	// Check if file exists locally (for development)
	const fixturesDir = join(process.cwd(), 'tests', 'fixtures', 'uploaded')
	const localFilePath = join(fixturesDir, audioFile.objectKey)
	const resolved = resolve(localFilePath)
	if (!resolved.startsWith(fixturesDir + sep)) {
		throw new Response('Invalid audio file path', { status: 500 })
	}
	const wantsStream = url.searchParams.has('stream')

	if (wantsStream) {
		if (existsSync(localFilePath)) {
			return serveLocalAudioFile(localFilePath, audioFile, request)
		}

		const { body, contentType, contentLength } = await getStorageObjectStream(
			audioFile.objectKey,
		)

		return new Response(body, {
			headers: {
				'Content-Type': contentType,
				...(contentLength ? { 'Content-Length': contentLength.toString() } : {}),
				'Accept-Ranges': 'bytes',
				'Cache-Control': 'private, max-age=3600',
			},
		})
	}

	if (existsSync(localFilePath)) {
		const streamUrl = new URL(url.href)
		streamUrl.searchParams.set('stream', '1')
		return Response.json({ url: streamUrl.toString() })
	}

	// Generate signed URL for remote storage (Tigris/S3)
	// Use longer expiry for audio files (1 hour)
	const { url: signedUrl } = await getFileUrl(audioFile.objectKey, 3600)

	// Return presigned URL directly — client sets it on <audio src>
	// No redirect: per decision #22 in CONTEXT.md, the client talks to Tigris CDN directly.
	// CORS on the Tigris bucket enables Range-seeking.
	return Response.json({ url: signedUrl })
}

