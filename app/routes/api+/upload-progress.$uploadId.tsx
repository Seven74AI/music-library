// @context7: React Router, Server-Sent Events, Streaming
import { data, type LoaderFunctionArgs } from 'react-router'
import { requireUserId } from '#app/utils/auth.server'

// Type for file data stored for retry capability
export interface StoredFileData {
	fileName: string
	buffer: Buffer
	mimeType?: string
	metadata: {
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
		[key: string]: unknown
	}
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

// In-memory store for upload progress (in production, use Redis)
const uploadProgressStore = new Map<
	string,
	{
		files: Array<{
			fileId: string
			fileName: string
			progress: number
			status: 'pending' | 'processing' | 'uploading' | 'completed' | 'failed'
			error?: string
		}>
		overallProgress: number
		status: 'active' | 'completed' | 'failed'
		successfulTracks?: Array<{
			trackId: string
			fileName: string
			title: string
			artist: string
		}>
		failedFiles?: Array<{
			fileId: string
			fileName: string
			error: string
			fileData?: StoredFileData
		}>
	}
>()

/**
 * Get upload progress for a session
 */
export function getUploadProgress(uploadId: string) {
	return uploadProgressStore.get(uploadId)
}

/**
 * Set upload progress for a session
 */
export function setUploadProgress(
	uploadId: string,
	progress: {
		files: Array<{
			fileId: string
			fileName: string
			progress: number
			status: 'pending' | 'processing' | 'uploading' | 'completed' | 'failed'
			error?: string
		}>
		overallProgress: number
		status: 'active' | 'completed' | 'failed'
		successfulTracks?: Array<{
			trackId: string
			fileName: string
			title: string
			artist: string
		}>
		failedFiles?: Array<{
			fileId: string
			fileName: string
			error: string
			fileData?: StoredFileData
		}>
	}
) {
	uploadProgressStore.set(uploadId, progress)
}

/**
 * Initialize upload progress for a session
 */
export function initUploadProgress(
	uploadId: string,
	fileNames: string[]
) {
	const files = fileNames.map((fileName, index) => ({
		fileId: `file-${index}`,
		fileName,
		progress: 0,
		status: 'pending' as const,
	}))

	setUploadProgress(uploadId, {
		files,
		overallProgress: 0,
		status: 'active',
		successfulTracks: [],
		failedFiles: [],
	})
}

/**
 * Update progress for a specific file
 */
export function updateFileProgress(
	uploadId: string,
	fileId: string,
	progress: number,
	status?: 'processing' | 'uploading' | 'completed' | 'failed',
	error?: string
) {
	const current = uploadProgressStore.get(uploadId)
	if (!current) return

	const fileIndex = current.files.findIndex(f => f.fileId === fileId)
	if (fileIndex === -1) return

	const file = current.files[fileIndex]
	if (!file) return

	if (status) {
		file.status = status
	}
	file.progress = progress
	if (error) {
		file.error = error
	}

	// Calculate overall progress
	const totalProgress = current.files.reduce((sum, file) => sum + file.progress, 0)
	current.overallProgress = Math.round(totalProgress / current.files.length)

	// Update status if all files are completed or failed
	const allCompleted = current.files.every(f => f.status === 'completed' || f.status === 'failed')
	if (allCompleted) {
		const hasFailures = current.files.some(f => f.status === 'failed')
		current.status = hasFailures ? 'failed' : 'completed'
	}

	uploadProgressStore.set(uploadId, current)
}

/**
 * Add successful track to progress store
 */
export function addSuccessfulTrack(
	uploadId: string,
	trackInfo: {
		trackId: string
		fileName: string
		title: string
		artist: string
	}
) {
	const current = uploadProgressStore.get(uploadId)
	if (!current) return

	if (!current.successfulTracks) {
		current.successfulTracks = []
	}
	current.successfulTracks.push(trackInfo)
	uploadProgressStore.set(uploadId, current)
}

/**
 * Add failed file to progress store with file data for retry
 */
export function addFailedFile(
	uploadId: string,
	fileId: string,
	error: string,
	fileData?: StoredFileData
) {
	const current = uploadProgressStore.get(uploadId)
	if (!current) return

	const file = current.files.find(f => f.fileId === fileId)
	if (!file) return

	if (!current.failedFiles) {
		current.failedFiles = []
	}
	current.failedFiles.push({
		fileId,
		fileName: file.fileName,
		error,
		fileData,
	})
	uploadProgressStore.set(uploadId, current)
}

/**
 * Clean up old progress entries (older than 1 hour)
 */
export function cleanupOldProgress() {
	// const oneHourAgo = Date.now() - 60 * 60 * 1000
	// TODO: Implement cleanup logic if needed
	// Note: We'd need to track timestamps for this, but for now we'll rely on manual cleanup
	// In production, use Redis with TTL
}

export async function loader({ params, request }: LoaderFunctionArgs) {
	await requireUserId(request)

	const uploadId = params.uploadId
	if (!uploadId) {
		return data({ error: 'Upload ID is required' }, { status: 400 })
	}

	// Create SSE stream
	const stream = new ReadableStream({
		start(controller) {
			// Send initial connection message
			const encoder = new TextEncoder()
			controller.enqueue(encoder.encode('data: {"type":"connected"}\n\n'))

			// Poll for progress updates
			const interval = setInterval(() => {
				const progress = getUploadProgress(uploadId)

				if (!progress) {
					// Upload session not found or expired
					controller.enqueue(
						encoder.encode('data: {"type":"error","message":"Upload session not found"}\n\n')
					)
					clearInterval(interval)
					controller.close()
					return
				}

				// Send progress update
				controller.enqueue(
					encoder.encode(`data: ${JSON.stringify({ type: 'progress', ...progress })}\n\n`)
				)

				// Close stream if upload is completed or failed
				if (progress.status === 'completed' || progress.status === 'failed') {
					clearInterval(interval)
					// Send final update with completion data before closing
					controller.enqueue(
						encoder.encode(`data: ${JSON.stringify({ type: 'progress', ...progress })}\n\n`)
					)
					// Keep data for a bit longer to allow client to fetch it
					setTimeout(() => {
						uploadProgressStore.delete(uploadId)
					}, 30000) // Keep for 30 seconds to allow completion screen to load
					controller.close()
				}
			}, 500) // Poll every 500ms

			// Cleanup on client disconnect
			request.signal.addEventListener('abort', () => {
				clearInterval(interval)
				controller.close()
			})
		},
	})

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive',
		},
	})
}

