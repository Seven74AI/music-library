// @context7: @mjackson/form-data-parser, @paralleldrive/cuid2, Prisma, Zod, React Router
import { parseFormData } from '@mjackson/form-data-parser'
import { createId } from '@paralleldrive/cuid2'
import { data, type ActionFunctionArgs } from 'react-router'
import { LOCAL_SERVICE } from '#app/constants/services'
import { getOrCreateArtistTx, extractArtistMetadata } from '#app/utils/artist-management.server'
import { extractAudioMetadata } from '#app/utils/audio-metadata.server'
import { requireUserId } from '#app/utils/auth.server'
import { findOrCreateCoverImageTx, getOrCreateAlbumTx } from '#app/utils/cover-management.server'
import { prisma } from '#app/utils/db.server'
import { uploadFile } from '#app/utils/storage.server'

// Maximum file size: 100MB
const MAX_FILE_SIZE = 100 * 1024 * 1024

// Allowed audio MIME types
const ALLOWED_MIME_TYPES = [
	'audio/mpeg',
	'audio/mp3',
	'audio/flac',
	'audio/wav',
	'audio/wave',
	'audio/mp4',
	'audio/m4a',
	'audio/aac',
	'audio/ogg',
	'audio/webm',
]

/**
 * Generate storage key for audio file
 */
function generateAudioFileKey(
	trackId: string,
	serviceId: string | null,
	format: string,
	fileId: string,
	extension: string
): string {
	const service = serviceId || 'local'
	const timestamp = Date.now()
	return `audio/tracks/${trackId}/${service}/${format}/${timestamp}-${fileId}.${extension}`
}

/**
 * Get file extension from filename or MIME type
 */
function getFileExtension(fileName: string, mimeType?: string | null): string {
	// Try filename first
	const extFromName = fileName.split('.').pop()?.toLowerCase()
	if (extFromName) {
		return extFromName
	}

	// Fallback to MIME type
	if (mimeType) {
		const mimeToExt: Record<string, string> = {
			'audio/mpeg': 'mp3',
			'audio/mp3': 'mp3',
			'audio/flac': 'flac',
			'audio/wav': 'wav',
			'audio/wave': 'wav',
			'audio/mp4': 'm4a',
			'audio/m4a': 'm4a',
			'audio/aac': 'aac',
			'audio/ogg': 'ogg',
			'audio/webm': 'webm',
		}
		return mimeToExt[mimeType] || 'mp3'
	}

	return 'mp3' // Default fallback
}

export async function action({ request }: ActionFunctionArgs) {
	const userId = await requireUserId(request)

	// Parse form data with file size limit
	const formData = await parseFormData(request, { maxFileSize: MAX_FILE_SIZE })

	// Validate file
	const audioFile = formData.get('audioFile')
	if (!(audioFile instanceof File)) {
		return data(
			{ success: false, error: 'Audio file is required' },
			{ status: 400 }
		)
	}

	// Validate file size
	if (audioFile.size > MAX_FILE_SIZE) {
		return data(
			{
				success: false,
				error: `File size exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
			},
			{ status: 400 }
		)
	}

	// Validate MIME type
	if (!ALLOWED_MIME_TYPES.includes(audioFile.type)) {
		return data(
			{
				success: false,
				error: `Invalid file type. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`,
			},
			{ status: 400 }
		)
	}

	try {
		// Get file buffer for metadata extraction
		const arrayBuffer = await audioFile.arrayBuffer()
		const buffer = Buffer.from(arrayBuffer)

		// Extract metadata from audio file
		const extractedMetadata = await extractAudioMetadata(
			buffer,
			audioFile.name
		)

		// Get form data for manual overrides
		const title = formData.get('title')?.toString() || extractedMetadata.title
		const artist = formData.get('artist')?.toString() || extractedMetadata.artist
		const album = formData.get('album')?.toString() || extractedMetadata.album

		// Validate required fields
		if (!title || !artist) {
			return data(
				{
					success: false,
					error: 'Title and artist are required (extract from file or provide manually)',
				},
				{ status: 400 }
			)
		}

		// Get or create local service
		const localService = await prisma.service.findUnique({
			where: { name: LOCAL_SERVICE.NAME },
		})

		if (!localService) {
			return data(
				{ success: false, error: 'Local service not found' },
				{ status: 500 }
			)
		}

		// Generate track ID
		const trackId = createId()

		// Generate file ID and key
		const fileId = createId()
		const format = extractedMetadata.format || 'mp3'
		const extension = getFileExtension(audioFile.name, audioFile.type)
		const objectKey = generateAudioFileKey(
			trackId,
			localService.id,
			format,
			fileId,
			extension
		)

		// Upload file to storage (outside transaction - storage can't be rolled back)
		await uploadFile({
			file: buffer,
			key: objectKey,
			contentType: extractedMetadata.mimeType || audioFile.type,
			metadata: {
				title: title,
				artist: artist,
				album: album || '',
				uploadedBy: userId,
			},
		})

		// Create track and audio file in transaction
		// All database operations (Artist, Album, CoverImage, Track) happen here
		const result = await prisma.$transaction(async (tx) => {
			// Get or create artist
			const artistMetadata = extractArtistMetadata(extractedMetadata)
			const artistRecord = await getOrCreateArtistTx(tx, artist, artistMetadata)

			// Get or create album (using artistId)
			const albumArtist = extractedMetadata.albumArtist || artist
			const albumArtistRecord = await getOrCreateArtistTx(tx, albumArtist, artistMetadata)
			const albumRecord = await getOrCreateAlbumTx(
				tx,
				albumArtistRecord.id,
				album || null,
				extractedMetadata.year || null
			)

			// Upload cover image if present (with deduplication)
			// Note: File upload happens outside transaction, but DB operations are in transaction
			let coverImageId: string | null = null
			if (extractedMetadata.coverImage) {
				try {
					const coverImage = await findOrCreateCoverImageTx(tx, {
						imageBuffer: extractedMetadata.coverImage.data,
						albumId: albumRecord?.id || null,
						trackId,
						format: extractedMetadata.coverImage.format,
					})
					coverImageId = coverImage.id
				} catch (error) {
					console.warn(`⚠️  Failed to upload cover image for ${audioFile.name}:`, error)
					// Continue without cover image
				}
			}

			// Create track
			const track = await tx.track.create({
				data: {
					id: trackId,
					title,
					artistId: artistRecord.id,
					albumId: albumRecord?.id || null,
					coverImageId,
					duration: extractedMetadata.duration || null,
					serviceId: localService.id,
					externalId: fileId, // Use fileId as externalId for local uploads
					serviceUrl: null,
					releaseDate: null,
				},
			})

			// Create audio file record
			const audioFileRecord = await tx.trackAudioFile.create({
				data: {
					trackId: track.id,
					serviceId: localService.id,
					objectKey,
					fileName: audioFile.name,
					fileSize: audioFile.size,
					mimeType: extractedMetadata.mimeType || audioFile.type,
					format,
					bitrate: extractedMetadata.bitrate || null,
					sampleRate: extractedMetadata.sampleRate || null,
					uploadedBy: userId,
				},
			})

			// Add track to user's library
			await tx.userTrack.create({
				data: {
					userId,
					trackId: track.id,
				},
			})

			return { track, audioFile: audioFileRecord }
		})

		// Fetch artist name for response
		const artistRecord = await prisma.artist.findUnique({
			where: { id: result.track.artistId },
			select: { name: true },
		})

		return data(
			{
				success: true,
				track: {
					id: result.track.id,
					title: result.track.title,
					artist: artistRecord?.name || 'Unknown Artist',
				},
			},
			{ status: 201 }
		)
	} catch (error) {
		console.error('Error uploading audio file:', error)
		const errorMessage =
			error instanceof Error ? error.message : 'Failed to upload audio file'
		return data(
			{ success: false, error: errorMessage },
			{ status: 500 }
		)
	}
}

