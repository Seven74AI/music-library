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
			fileSize?: number // File size in bytes for speed calculation
		}>
		overallProgress: number
		status: 'active' | 'completed' | 'failed'
		startTime?: number // Timestamp when upload started
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

// Store active SSE connections for real-time updates
const activeConnections = new Map<
	string,
	Set<ReadableStreamDefaultController>
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
			fileSize?: number
		}>
		overallProgress: number
		status: 'active' | 'completed' | 'failed'
		startTime?: number
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
		startTime: Date.now(),
		successfulTracks: [],
		failedFiles: [],
	})
}

/**
 * Push progress update to all active SSE connections for this upload
 */
function pushProgressUpdate(uploadId: string) {
	const progress = getUploadProgress(uploadId)
	if (!progress) return

	const connections = activeConnections.get(uploadId)
	if (!connections || connections.size === 0) return

	// Calculate upload speed
	let uploadSpeed = 0
	if (progress.startTime) {
		const elapsedSeconds = (Date.now() - progress.startTime) / 1000
		if (elapsedSeconds > 0) {
			// Calculate total bytes transferred
			const totalBytes = progress.files.reduce((sum, file) => {
				if (file.fileSize && file.status !== 'pending' && file.status !== 'processing') {
					// Only count bytes for files that are uploading or completed
					return sum + (file.fileSize * file.progress / 100)
				}
				return sum
			}, 0)
			uploadSpeed = totalBytes / elapsedSeconds // bytes per second
		}
	}

	// Create a clean progress object for JSON serialization
	// Avoid circular references and ensure all data is serializable
	const cleanProgress = {
		type: 'progress' as const,
		files: progress.files.map(file => ({
			fileId: file.fileId,
			fileName: file.fileName,
			progress: file.progress,
			status: file.status,
			error: file.error,
		})),
		overallProgress: progress.overallProgress,
		status: progress.status,
		uploadSpeed,
		successfulTracks: (progress.successfulTracks || []).map(track => ({
			trackId: track.trackId,
			fileName: track.fileName,
			title: track.title,
			artist: track.artist,
		})),
		failedFiles: (progress.failedFiles || []).map(file => ({
			fileId: file.fileId,
			fileName: file.fileName,
			error: file.error,
		})),
	}

	try {
		const encoder = new TextEncoder()
		const message = encoder.encode(
			`data: ${JSON.stringify(cleanProgress)}\n\n`
		)

		// Send to all active connections
		for (const controller of connections) {
			try {
				controller.enqueue(message)
			} catch {
				// Connection might be closed, remove it
				connections.delete(controller)
			}
		}
	} catch (error) {
		// If JSON.stringify fails, log error but don't crash
		console.error('Error serializing progress update:', error)
	}
}

/**
 * Update progress for a specific file
 */
export function updateFileProgress(
	uploadId: string,
	fileId: string,
	progress: number,
	status?: 'processing' | 'uploading' | 'completed' | 'failed',
	error?: string,
	fileSize?: number // Optional file size in bytes for speed calculation
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
	if (fileSize !== undefined) {
		file.fileSize = fileSize
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
	
	// Push update immediately to all active connections
	pushProgressUpdate(uploadId)
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
 * Note: In production, use Redis with TTL for automatic cleanup
 */
export function cleanupOldProgress() {
	// In-memory cleanup would require tracking timestamps
	// For now, progress entries are cleaned up when upload completes or fails
	// In production, use Redis with TTL for automatic expiration
}

export async function loader({ params, request }: LoaderFunctionArgs) {
	await requireUserId(request)

	const uploadId = params.uploadId
	if (!uploadId) {
		return data({ error: 'Upload ID is required' }, { status: 400 })
	}

	// Create SSE stream with real-time updates
	const stream = new ReadableStream({
		start(controller) {
			// Send initial connection message
			const encoder = new TextEncoder()
			controller.enqueue(encoder.encode('data: {"type":"connected"}\n\n'))

			// Register this connection for real-time updates
			if (!activeConnections.has(uploadId)) {
				activeConnections.set(uploadId, new Set())
			}
			activeConnections.get(uploadId)?.add(controller)

			// Send initial progress state
			const initialProgress = getUploadProgress(uploadId)
			if (initialProgress) {
				// Calculate initial upload speed
				let uploadSpeed = 0
				if (initialProgress.startTime) {
					const elapsedSeconds = (Date.now() - initialProgress.startTime) / 1000
					if (elapsedSeconds > 0) {
						const totalBytes = initialProgress.files.reduce((sum, file) => {
							if (file.fileSize && file.status !== 'pending' && file.status !== 'processing') {
								return sum + (file.fileSize * file.progress / 100)
							}
							return sum
						}, 0)
						uploadSpeed = totalBytes / elapsedSeconds
					}
				}
				// Create clean progress object to avoid JSON.stringify issues
				const cleanInitialProgress = {
					type: 'progress' as const,
					files: initialProgress.files.map(file => ({
						fileId: file.fileId,
						fileName: file.fileName,
						progress: file.progress,
						status: file.status,
						error: file.error,
					})),
					overallProgress: initialProgress.overallProgress,
					status: initialProgress.status,
					uploadSpeed,
					successfulTracks: (initialProgress.successfulTracks || []).map(track => ({
						trackId: track.trackId,
						fileName: track.fileName,
						title: track.title,
						artist: track.artist,
					})),
					failedFiles: (initialProgress.failedFiles || []).map(file => ({
						fileId: file.fileId,
						fileName: file.fileName,
						error: file.error,
					})),
				}
				controller.enqueue(
					encoder.encode(`data: ${JSON.stringify(cleanInitialProgress)}\n\n`)
				)
			}

			// Periodic heartbeat to check if upload is completed (fallback for edge cases)
			const heartbeat = setInterval(() => {
				const progress = getUploadProgress(uploadId)

				if (!progress) {
					controller.enqueue(
						encoder.encode('data: {"type":"error","message":"Upload session not found"}\n\n')
					)
					clearInterval(heartbeat)
					controller.close()
					return
				}

				// Close stream if upload is completed or failed
				if (progress.status === 'completed' || progress.status === 'failed') {
					clearInterval(heartbeat)
					// Send final update
					let uploadSpeed = 0
					if (progress.startTime) {
						const elapsedSeconds = (Date.now() - progress.startTime) / 1000
						if (elapsedSeconds > 0) {
							const totalBytes = progress.files.reduce((sum, file) => {
								if (file.fileSize) {
									return sum + (file.fileSize * file.progress / 100)
								}
								return sum
							}, 0)
							uploadSpeed = totalBytes / elapsedSeconds
						}
					}
					// Create clean progress object
					const cleanFinalProgress = {
						type: 'progress' as const,
						files: progress.files.map(file => ({
							fileId: file.fileId,
							fileName: file.fileName,
							progress: file.progress,
							status: file.status,
							error: file.error,
						})),
						overallProgress: progress.overallProgress,
						status: progress.status,
						uploadSpeed,
						successfulTracks: (progress.successfulTracks || []).map(track => ({
							trackId: track.trackId,
							fileName: track.fileName,
							title: track.title,
							artist: track.artist,
						})),
						failedFiles: (progress.failedFiles || []).map(file => ({
							fileId: file.fileId,
							fileName: file.fileName,
							error: file.error,
						})),
					}
					controller.enqueue(
						encoder.encode(`data: ${JSON.stringify(cleanFinalProgress)}\n\n`)
					)
					// Keep data for a bit longer to allow client to fetch it
					setTimeout(() => {
						uploadProgressStore.delete(uploadId)
						activeConnections.delete(uploadId)
					}, 30000) // Keep for 30 seconds to allow completion screen to load
					controller.close()
				}
			}, 1000) // Check every 1 second (just for completion detection)

			// Cleanup on client disconnect
			request.signal.addEventListener('abort', () => {
				clearInterval(heartbeat)
				activeConnections.get(uploadId)?.delete(controller)
				if (activeConnections.get(uploadId)?.size === 0) {
					activeConnections.delete(uploadId)
				}
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

