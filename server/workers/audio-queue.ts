import { prisma } from '../utils/db.js'

import { archiveTrackAudio } from '../workers/audio-archive.js'

// Constants
const DEFAULT_MAX_CONCURRENT = 2
const MIN_CONCURRENT = 1
const MAX_CONCURRENT = 10

const RETRY_DELAYS = [
  5 * 60 * 1000,    // 5 minutes
  30 * 60 * 1000,   // 30 minutes
  2 * 60 * 60 * 1000, // 2 hours
] as const

/**
 * Get validated max concurrent downloads from environment
 * @returns The maximum number of concurrent downloads, validated against limits
 */
function getMaxConcurrentDownloads(): number {
  const envValue = process.env.AUDIO_ARCHIVE_MAX_CONCURRENT
  if (!envValue) {
    return DEFAULT_MAX_CONCURRENT
  }
  
  const parsed = parseInt(envValue, 10)
  if (isNaN(parsed) || parsed < MIN_CONCURRENT || parsed > MAX_CONCURRENT) {
    console.warn(`Invalid AUDIO_ARCHIVE_MAX_CONCURRENT value: ${envValue}. Using default: ${DEFAULT_MAX_CONCURRENT}`)
    return DEFAULT_MAX_CONCURRENT
  }
  
  return parsed
}

const MAX_CONCURRENT_DOWNLOADS = getMaxConcurrentDownloads()

/**
 * Validate track ID parameter
 * @param trackId - The track ID to validate
 * @throws {Error} If the track ID is invalid
 */
function validateTrackId(trackId: string): void {
  if (!trackId || typeof trackId !== 'string' || trackId.trim().length === 0) {
    throw new Error('Invalid trackId: must be a non-empty string')
  }
}

/**
 * Validate priority parameter
 * @param priority - The priority value to validate
 * @returns The validated boolean priority value
 * @throws {Error} If the priority is not a boolean
 */
function validatePriority(priority: unknown): boolean {
  if (typeof priority !== 'boolean') {
    throw new Error('Invalid priority: must be a boolean')
  }
  return priority
}

/**
 * Enqueue a track for archiving
 * Creates or updates a track audio file record for processing
 * @param trackId - The ID of the track to enqueue
 * @param priority - Whether to prioritize this track (default: false)
 * @returns Promise that resolves when the track is successfully enqueued
 * @throws {Error} If trackId is invalid or database operation fails
 */
export async function enqueueTrack(trackId: string, priority = false): Promise<void> {
  // Validate inputs
  validateTrackId(trackId)
  const validatedPriority = validatePriority(priority)
  // Check if track already has an audio file record
  const existingAudioFile = await prisma.trackAudioFile.findUnique({
    where: { trackId },
  })

  if (existingAudioFile) {
    // If it exists and is completed, no need to enqueue
    if (existingAudioFile.status === 'completed') {
      console.log(`Track ${trackId} already has completed audio file`)
      return
    }
    
    // If it exists but failed, reset it for retry
    if (existingAudioFile.status === 'failed') {
      await prisma.trackAudioFile.update({
        where: { trackId },
        data: {
          status: 'pending',
          priority: validatedPriority,
          retryCount: 0,
          lastAttemptAt: null,
          // Keep error history for debugging
        },
      })
      console.log(`Reset failed track ${trackId} for retry with priority: ${validatedPriority}`)
      return
    }

    // If it's pending or processing, just update priority
    if (existingAudioFile.status === 'pending' || existingAudioFile.status === 'processing') {
      await prisma.trackAudioFile.update({
        where: { trackId },
        data: { priority: validatedPriority },
      })
      console.log(`Updated priority for track ${trackId}: ${validatedPriority}`)
      return
    }
  }

  // Create new audio file record
  await prisma.trackAudioFile.create({
    data: {
      trackId,
      status: 'pending',
      priority: validatedPriority,
      retryCount: 0,
    },
  })

  console.log(`Enqueued track ${trackId} for archiving with priority: ${validatedPriority}`)
}

/**
 * Get tracks eligible for retry based on exponential backoff
 * Filters failed tracks that are ready for retry based on timing
 * @returns Promise resolving to array of track IDs ready for retry
 */
export async function getRetryableTracks(): Promise<{ trackId: string }[]> {
  const now = new Date()
  
  const retryableTracks = await prisma.trackAudioFile.findMany({
    where: {
      status: 'failed',
      retryCount: { lt: 3 }, // Max 3 retries
      lastAttemptAt: {
        not: null,
      },
    },
    select: {
      trackId: true,
      retryCount: true,
      lastAttemptAt: true,
    },
  })

  // Filter by exponential backoff timing
  const eligibleTracks = retryableTracks.filter((track) => {
    if (!track.lastAttemptAt) return false
    
    const retryDelay = RETRY_DELAYS[track.retryCount]
    const fallbackDelay = RETRY_DELAYS[RETRY_DELAYS.length - 1]
    
    if (fallbackDelay === undefined) {
      throw new Error('RETRY_DELAYS array must not be empty')
    }
    
    const delayMs = retryDelay ?? fallbackDelay
    const nextRetryTime = new Date(track.lastAttemptAt.getTime() + delayMs)
    
    return now >= nextRetryTime
  })

  return eligibleTracks.map(track => ({ trackId: track.trackId }))
}

/**
 * Reset a track for retry (admin function)
 * Resets a failed track to pending status for manual retry
 * @param trackId - The ID of the track to reset
 * @param priority - Whether to prioritize this track (default: false)
 * @returns Promise that resolves when the track is successfully reset
 * @throws {Error} If trackId is invalid or track not found
 */
export async function resetTrackForRetry(trackId: string, priority = false): Promise<void> {
  const audioFile = await prisma.trackAudioFile.findUnique({
    where: { trackId },
  })

  if (!audioFile) {
    throw new Error(`AudioFile not found for track: ${trackId}`)
  }

  await prisma.trackAudioFile.update({
    where: { trackId },
    data: {
      status: 'pending',
      priority,
      retryCount: 0,
      lastAttemptAt: null,
      // Keep error history for debugging
    },
  })

  console.log(`Reset track ${trackId} for retry with priority: ${priority}`)
}

/**
 * Process the queue - get pending tracks and process them concurrently
 * Fetches pending and retryable tracks, processes them up to the concurrent limit
 * @returns Promise resolving to processing results with counts of successful and failed operations
 */
export async function processQueue(): Promise<{ processed: number; errors: number }> {
  console.log('Starting queue processing...')

  // Check if worker is paused or in long break
  const workerState = await prisma.workerState.findUnique({
    where: { id: 'singleton' },
  })

  if (!workerState) {
    console.warn('WorkerState not found, skipping queue processing')
    return { processed: 0, errors: 0 }
  }

  if (workerState.status === 'paused' || workerState.status === 'long_break') {
    console.log(`Worker is ${workerState.status}, skipping queue processing`)
    return { processed: 0, errors: 0 }
  }

  // Get pending tracks with priority-first, FIFO ordering
  const pendingTracks = await prisma.trackAudioFile.findMany({
    where: {
      status: 'pending',
    },
    orderBy: [
      { priority: 'desc' }, // Priority tracks first
      { createdAt: 'asc' }, // Then FIFO
    ],
    take: MAX_CONCURRENT_DOWNLOADS,
    select: {
      trackId: true,
    },
  })

  // Also get retryable tracks
  const retryableTracks = await getRetryableTracks()
  
  // Combine and limit to max concurrent
  const allTracks = [...pendingTracks, ...retryableTracks].slice(0, MAX_CONCURRENT_DOWNLOADS)

  if (allTracks.length === 0) {
    console.log('No tracks to process in queue')
    return { processed: 0, errors: 0 }
  }

  console.log(`Processing ${allTracks.length} tracks concurrently`)

  // Process tracks concurrently
  const results = await Promise.allSettled(
    allTracks.map(track => archiveTrackAudio(track.trackId))
  )

  const processed = results.filter(result => result.status === 'fulfilled').length
  const errors = results.filter(result => result.status === 'rejected').length

  // Update worker state
  await prisma.workerState.update({
    where: { id: 'singleton' },
    data: {
      lastQueueRun: new Date(),
    },
  })

  console.log(`Queue processing promises completed: ${processed} successful, ${errors} failed`)

  // Log any errors
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      const track = allTracks[index]
      if (track) {
        console.error(`Track ${track.trackId} failed:`, result.reason)
      }
    }
  })

  return { processed, errors }
}

/**
 * Get queue statistics
 * Fetches counts of tracks in each status and calculates success rate
 * @returns Promise resolving to queue statistics object
 */
export async function getQueueStats() {
  const [
    pendingCount,
    processingCount,
    completedCount,
    failedCount,
    workerState,
  ] = await Promise.all([
    prisma.trackAudioFile.count({ where: { status: 'pending' } }),
    prisma.trackAudioFile.count({ where: { status: 'processing' } }),
    prisma.trackAudioFile.count({ where: { status: 'completed' } }),
    prisma.trackAudioFile.count({ where: { status: 'failed' } }),
    prisma.workerState.findUnique({ where: { id: 'singleton' } }),
  ])

  const total = pendingCount + processingCount + completedCount + failedCount
  const successRate = total > 0 ? Math.round((completedCount / total) * 100) : 0

  return {
    pending: pendingCount,
    processing: processingCount,
    completed: completedCount,
    failed: failedCount,
    total,
    successRate,
    workerState,
  }
}

/**
 * Get tracks for admin display
 * Fetches tracks with pagination and filtering for the admin interface
 * @param options - Configuration options for the query
 * @param options.status - Filter by track status (optional)
 * @param options.limit - Maximum number of tracks to return (default: 50)
 * @param options.offset - Number of tracks to skip for pagination (default: 0)
 * @returns Promise resolving to tracks data with pagination info
 */
export async function getTracksForAdmin(options: {
  status?: string
  limit?: number
  offset?: number
}) {
  const { status, limit = 50, offset = 0 } = options

  const where = status && status !== 'all' ? { status } : {}

  const [tracks, totalCount] = await Promise.all([
    prisma.trackAudioFile.findMany({
      where,
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'desc' },
      ],
      take: limit,
      skip: offset,
      include: {
        track: {
          include: {
            service: true,
          },
        },
      },
    }),
    prisma.trackAudioFile.count({ where }),
  ])

  return {
    tracks,
    totalCount,
    hasMore: offset + limit < totalCount,
  }
}
