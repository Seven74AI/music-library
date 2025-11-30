// @context7: @mjackson/form-data-parser, @paralleldrive/cuid2, Prisma, React Router
import { parseFormData } from '@mjackson/form-data-parser'
import { createId } from '@paralleldrive/cuid2'
import { data, type ActionFunctionArgs } from 'react-router'
import { LOCAL_SERVICE } from '#app/constants/services'
import { getOrCreateArtistTx, extractArtistMetadata } from '#app/utils/artist-management.server'
import { extractAudioMetadata, type ExtractedAudioMetadata } from '#app/utils/audio-metadata.server'
import { findOrCreateCoverImageTx, getOrCreateAlbumTx } from '#app/utils/cover-management.server'
import { prisma } from '#app/utils/db.server'
import { requireUserWithRole } from '#app/utils/permissions.server'
import { uploadFile } from '#app/utils/storage.server'
import { extractAudioFilesFromZip } from '#app/utils/zip-extraction.server'
import {
	initUploadProgress,
	updateFileProgress,
	addSuccessfulTrack,
	addFailedFile,
	type StoredFileData,
} from './upload-progress.$uploadId'

// Maximum file size: 100MB per file, 500MB for ZIP
const MAX_FILE_SIZE = 100 * 1024 * 1024
const MAX_ZIP_SIZE = 500 * 1024 * 1024

// Allowed audio MIME types
const ALLOWED_AUDIO_MIME_TYPES = [
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

// Allowed ZIP MIME types
const ALLOWED_ZIP_MIME_TYPES = [
	'application/zip',
	'application/x-zip-compressed',
	'application/x-zip',
]

// Maximum concurrency for parallel processing
const MAX_CONCURRENCY = 5

/**
 * Process items in parallel with a concurrency limit
 * @param items - Array of items to process
 * @param processor - Function to process each item
 * @param concurrency - Maximum number of concurrent operations (default: MAX_CONCURRENCY)
 * @returns Promise that resolves when all items are processed
 */
async function processWithConcurrency<T, R>(
	items: T[],
	processor: (item: T, index: number) => Promise<R>,
	concurrency: number = MAX_CONCURRENCY
): Promise<R[]> {
	const results: R[] = []
	
	for (let i = 0; i < items.length; i += concurrency) {
		const batch = items.slice(i, i + concurrency)
		const batchResults = await Promise.all(
			batch.map((item, batchIndex) => processor(item, i + batchIndex))
		)
		results.push(...batchResults)
	}
	
	return results
}

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
	const extFromName = fileName.split('.').pop()?.toLowerCase()
	if (extFromName) {
		return extFromName
	}

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

	return 'mp3'
}

interface FileWithMetadata {
	fileName: string
	buffer: Buffer
	mimeType?: string
	metadata: ExtractedAudioMetadata
	userMetadata?: {
		title?: string
		artist?: string
		album?: string
		genre?: string
		year?: number
		trackNumber?: number
		albumArtist?: string
		bpm?: number
		label?: string
		isrc?: string
		originalDate?: string
		originalYear?: number
		releaseDate?: string
		totalTracks?: number
		totalDiscs?: number
		lyrics?: string
	}
}

export async function action({ request }: ActionFunctionArgs) {
	const userId = await requireUserWithRole(request, 'admin')

	// Parse form data
	const formData = await parseFormData(request, { maxFileSize: MAX_ZIP_SIZE })

	// Get upload session ID or create one
	const uploadId = formData.get('uploadId')?.toString() || createId()

	// Get files - can be single file, multiple files, or ZIP
	const fileInput = formData.get('file')
	const filesInput = formData.getAll('files')
	const zipInput = formData.get('zipFile')

	let filesToProcess: FileWithMetadata[] = []

	// Handle ZIP file
	if (zipInput instanceof File || (fileInput instanceof File && (ALLOWED_ZIP_MIME_TYPES.includes(fileInput.type) || fileInput.name.toLowerCase().endsWith('.zip')))) {
		const zipFile = zipInput instanceof File ? zipInput : fileInput as File

		if (zipFile.size > MAX_ZIP_SIZE) {
			return data(
				{
					success: false,
					error: `ZIP file size exceeds maximum of ${MAX_ZIP_SIZE / 1024 / 1024}MB`,
				},
				{ status: 400 }
			)
		}

		try {
			const arrayBuffer = await zipFile.arrayBuffer()
			const zipBuffer = Buffer.from(arrayBuffer)
			const extractedFiles = await extractAudioFilesFromZip(zipBuffer)

			// Initialize progress tracking
			initUploadProgress(uploadId, extractedFiles.map(f => f.fileName))

			// Extract metadata from each file in parallel (max 5 concurrent)
			await processWithConcurrency(
				extractedFiles,
				async (extractedFile, i) => {
					const fileId = `file-${i}`
					
					try {
						updateFileProgress(uploadId, fileId, 0, 'processing')
						const metadata = await extractAudioMetadata(extractedFile.buffer, extractedFile.fileName)

						// Get user-provided metadata for this file (if any)
						const userMetadata = formData.get(`metadata[${i}]`)?.toString()
						const parsedMetadata = userMetadata ? (JSON.parse(userMetadata) as FileWithMetadata['userMetadata']) : undefined

						filesToProcess.push({
							fileName: extractedFile.fileName,
							buffer: extractedFile.buffer,
							mimeType: metadata.mimeType,
							metadata,
							userMetadata: parsedMetadata,
						})
					} catch (error) {
						updateFileProgress(uploadId, fileId, 0, 'failed', error instanceof Error ? error.message : 'Failed to extract metadata')
						console.error(`Error extracting metadata from ${extractedFile.fileName}:`, error)
					}
				},
				MAX_CONCURRENCY
			)
		} catch (error) {
			return data(
				{
					success: false,
					error: `Failed to extract ZIP file: ${error instanceof Error ? error.message : 'Unknown error'}`,
				},
				{ status: 400 }
			)
		}
	} else {
		// Handle single or multiple audio files
		const audioFiles: File[] = []

		if (fileInput instanceof File) {
			audioFiles.push(fileInput)
		} else if (filesInput.length > 0 && filesInput.every(f => f instanceof File)) {
			audioFiles.push(...(filesInput as File[]))
		} else {
			return data(
				{
					success: false,
					error: 'No file or files provided',
				},
				{ status: 400 }
			)
		}

		// Validate files
		for (const file of audioFiles) {
			if (file.size === 0) {
				return data(
					{
						success: false,
						error: `File ${file.name} is empty`,
					},
					{ status: 400 }
				)
			}

			if (file.size > MAX_FILE_SIZE) {
				return data(
					{
						success: false,
						error: `File ${file.name} exceeds maximum size of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
					},
					{ status: 400 }
				)
			}

			if (!ALLOWED_AUDIO_MIME_TYPES.includes(file.type)) {
				return data(
					{
						success: false,
						error: `File ${file.name} has invalid MIME type: ${file.type}`,
					},
					{ status: 400 }
				)
			}
		}

		// Initialize progress tracking
		initUploadProgress(uploadId, audioFiles.map(f => f.name))

		// Extract metadata from each file in parallel (max 5 concurrent)
		await processWithConcurrency(
			audioFiles,
			async (file, i) => {
				const fileId = `file-${i}`
				
				try {
					updateFileProgress(uploadId, fileId, 0, 'processing')
					const arrayBuffer = await file.arrayBuffer()
					const buffer = Buffer.from(arrayBuffer)
					const metadata = await extractAudioMetadata(buffer, file.name)

					// Get user-provided metadata for this file (if any)
					const userMetadata = formData.get(`metadata[${i}]`)?.toString()
					const parsedMetadata = userMetadata ? (JSON.parse(userMetadata) as FileWithMetadata['userMetadata']) : undefined

					filesToProcess.push({
						fileName: file.name,
						buffer,
						mimeType: file.type,
						metadata,
						userMetadata: parsedMetadata,
					})
				} catch (error) {
					updateFileProgress(uploadId, fileId, 0, 'failed', error instanceof Error ? error.message : 'Failed to extract metadata')
					console.error(`Error extracting metadata from ${file.name}:`, error)
				}
			},
			MAX_CONCURRENCY
		)
	}

	if (filesToProcess.length === 0) {
		return data(
			{
				success: false,
				error: 'No valid audio files to upload',
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

	// Process files asynchronously (don't await, return upload ID immediately)
	void processFilesAsync(uploadId, filesToProcess, userId, localService.id)

	return data(
		{
			success: true,
			uploadId,
			message: 'Upload started',
		},
		{ status: 202 } // Accepted - processing asynchronously
	)
}

/**
 * Process files asynchronously and update progress
 */
async function processFilesAsync(
	uploadId: string,
	files: FileWithMetadata[],
	userId: string,
	serviceId: string
) {
	// Process files in parallel (max 5 concurrent)
	await processWithConcurrency(
		files,
		async (file, i): Promise<{ success: boolean; trackId?: string; error?: string }> => {
			const fileId = `file-${i}`

			try {
				// Use user metadata if provided, otherwise use extracted metadata
				const title = file.userMetadata?.title || file.metadata.title
				const artist = file.userMetadata?.artist || file.metadata.artist
				const album = file.userMetadata?.album || file.metadata.album

				// Validate required fields
				if (!title || !artist) {
					updateFileProgress(uploadId, fileId, 0, 'failed', 'Title and artist are required')
					return { success: false, error: 'Title and artist are required' }
				}

				updateFileProgress(uploadId, fileId, 5, 'uploading', undefined, file.buffer.length)

				// Generate IDs
				const trackId = createId()
				const fileIdForStorage = createId()
				const format = file.metadata.format || 'mp3'
				const extension = getFileExtension(file.fileName, file.mimeType)
				const objectKey = generateAudioFileKey(
					trackId,
					serviceId,
					format,
					fileIdForStorage,
					extension
				)

				updateFileProgress(uploadId, fileId, 10, 'uploading', undefined, file.buffer.length)

				// Upload file to storage with real-time progress tracking
				// Progress: 10% -> 50% (40% for file upload, updated in real-time)
				const uploadStartProgress = 10
				const uploadEndProgress = 50
				const uploadProgressRange = uploadEndProgress - uploadStartProgress
				
				await uploadFile({
					file: file.buffer,
					key: objectKey,
					contentType: file.metadata.mimeType || file.mimeType || 'audio/mpeg',
					metadata: {
						title,
						artist,
						album: album || '',
						uploadedBy: userId,
					},
					onProgress: (progress) => {
						// Calculate progress percentage based on bytes uploaded
						if (progress.total && progress.total > 0) {
							const uploadPercentage = (progress.loaded / progress.total) * uploadProgressRange
							const currentProgress = Math.round(uploadStartProgress + uploadPercentage)
							updateFileProgress(uploadId, fileId, currentProgress, 'uploading', undefined, file.buffer.length)
						}
					},
				})
				
				// Ensure we're at 50% after upload completes
				updateFileProgress(uploadId, fileId, 50, 'uploading', undefined, file.buffer.length)

				// Create track and audio file in transaction
				// All database operations (Artist, Album, CoverImage, Track) happen here
				// Note: Increased timeout to 30s to accommodate image processing and file uploads
				const result = await prisma.$transaction(async (tx) => {
					// Get or create artist
					const artistMetadata = extractArtistMetadata(file.metadata)
					const artistRecord = await getOrCreateArtistTx(tx, artist, artistMetadata)

					// Get or create album (using artistId)
					const albumArtist = file.userMetadata?.albumArtist || file.metadata.albumArtist || artist
					const albumArtistRecord = await getOrCreateArtistTx(tx, albumArtist, artistMetadata)
					const albumRecord = await getOrCreateAlbumTx(
						tx,
						albumArtistRecord.id,
						album || null,
						file.userMetadata?.year || file.metadata.year || null
					)

					// Upload cover image if present (with deduplication)
					// Note: File upload happens outside transaction, but DB operations are in transaction
					let coverImageId: string | null = null
					if (file.metadata.coverImage) {
						try {
							const coverImage = await findOrCreateCoverImageTx(tx, {
								imageBuffer: file.metadata.coverImage.data,
								albumId: albumRecord?.id || null,
								trackId,
								format: file.metadata.coverImage.format,
							})
							coverImageId = coverImage.id
						} catch (error) {
							console.warn(`⚠️  Failed to upload cover image for ${file.fileName}:`, error)
							// Continue without cover image
						}
					}

					// Create track with all metadata fields
					updateFileProgress(uploadId, fileId, 60, 'uploading')
					const track = await tx.track.create({
						data: {
							id: trackId,
							title,
							artistId: artistRecord.id,
							albumId: albumRecord?.id || null,
							coverImageId,
							duration: file.metadata.duration || null,
							serviceId: serviceId || null,
							externalId: fileIdForStorage,
							serviceUrl: null,
							releaseDate: file.userMetadata?.releaseDate 
								? new Date(file.userMetadata.releaseDate) 
								: (file.metadata.releaseDate ? new Date(file.metadata.releaseDate) : null),
							// Basic metadata
							genre: file.userMetadata?.genre || (file.metadata.genre?.[0] || null),
							year: file.userMetadata?.year || file.metadata.year || null,
							trackNumber: file.userMetadata?.trackNumber || file.metadata.track?.no || null,
							albumArtist: file.userMetadata?.albumArtist || file.metadata.albumArtist || null,
							// Additional metadata
							bpm: file.userMetadata?.bpm || file.metadata.bpm || null,
							label: file.userMetadata?.label || file.metadata.label || null,
							isrc: file.userMetadata?.isrc || file.metadata.isrc || null,
							originalDate: file.userMetadata?.originalDate 
								? new Date(file.userMetadata.originalDate) 
								: (file.metadata.originalDate ? new Date(file.metadata.originalDate) : null),
							originalYear: file.userMetadata?.originalYear || file.metadata.originalYear || null,
							totalTracks: file.userMetadata?.totalTracks || file.metadata.totalTracks || null,
							totalDiscs: file.userMetadata?.totalDiscs || file.metadata.totalDiscs || null,
							lyrics: file.userMetadata?.lyrics || file.metadata.lyrics || null,
						},
					})

					updateFileProgress(uploadId, fileId, 75, 'uploading')

					// Create audio file record
					await tx.trackAudioFile.create({
						data: {
							trackId: track.id,
							serviceId,
							objectKey,
							fileName: file.fileName,
							fileSize: file.buffer.length,
							mimeType: file.metadata.mimeType || file.mimeType,
							format,
							bitrate: file.metadata.bitrate || null,
							sampleRate: file.metadata.sampleRate || null,
							uploadedBy: userId,
						},
					})

					updateFileProgress(uploadId, fileId, 85, 'uploading')

					// Add track to user's library
					await tx.userTrack.create({
						data: {
							userId,
							trackId: track.id,
						},
					})

					updateFileProgress(uploadId, fileId, 95, 'uploading')
					
					// Store successful track information
					addSuccessfulTrack(uploadId, {
						trackId: track.id,
						fileName: file.fileName,
						title: track.title,
						artist: artistRecord.name,
					})
					
					return { success: true, trackId: track.id }
				}, {
					timeout: 30000, // 30 seconds - increased to accommodate image processing and file uploads
					maxWait: 10000, // 10 seconds - maximum time to wait for transaction to start
				})
				
				// Update to 100% after transaction completes successfully
				updateFileProgress(uploadId, fileId, 100, 'completed', undefined, file.buffer.length)
				
				return result
			} catch (error) {
				console.error(`Error uploading file ${file.fileName}:`, error)
				const errorMessage = error instanceof Error ? error.message : 'Failed to upload file'
				updateFileProgress(uploadId, fileId, 0, 'failed', errorMessage)
				
				// Store failed file data for retry
				const storedFileData: StoredFileData = {
					fileName: file.fileName,
					buffer: file.buffer,
					mimeType: file.mimeType,
					metadata: {
						title: file.metadata.title,
						artist: file.metadata.artist,
						album: file.metadata.album,
						genre: file.metadata.genre?.[0],
						year: file.metadata.year,
						trackNumber: file.metadata.track?.no,
						albumArtist: file.metadata.albumArtist,
						bpm: file.metadata.bpm,
						label: file.metadata.label,
						isrc: file.metadata.isrc,
						originalDate: file.metadata.originalDate,
						originalYear: file.metadata.originalYear,
						releaseDate: file.metadata.releaseDate,
						totalTracks: file.metadata.totalTracks,
						totalDiscs: file.metadata.totalDiscs,
						lyrics: file.metadata.lyrics,
					},
					userMetadata: file.userMetadata,
				}
				addFailedFile(uploadId, fileId, errorMessage, storedFileData)
				
				return { success: false, error: errorMessage }
			}
		},
		MAX_CONCURRENCY
	)
	
	// Results are now collected from the parallel processing
	// (kept for potential future use, though not currently used)
}

