import { readFile, unlink } from 'fs/promises'
import { execa } from 'execa'

import { prisma } from '../utils/db.js'
import { uploadAudioFile } from '../utils/storage.js'

/**
 * Extract duration from audio file using ffprobe
 * @param filePath - Path to the audio file
 * @returns Duration in seconds, or null if extraction fails
 */
async function extractAudioDuration(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execa('ffprobe', [
      '-v', 'quiet',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      filePath
    ])
    
    const duration = parseFloat(stdout.trim())
    return isNaN(duration) ? null : Math.round(duration)
  } catch (error) {
    console.warn(`Failed to extract duration from ${filePath}:`, error)
    return null
  }
}

// Constants
const SLEEP_INTERVAL_MIN = 2 // Minimum sleep interval
const SLEEP_INTERVAL_MAX = 5 // Maximum sleep interval

// Error codes for standardized error handling
export const ERROR_CODES = {
  VIDEO_UNAVAILABLE: 'VIDEO_UNAVAILABLE',
  RATE_LIMITED: 'RATE_LIMITED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  CONVERSION_FAILED: 'CONVERSION_FAILED',
  YOUTUBE_ERROR: 'YOUTUBE_ERROR',
  STORAGE_ERROR: 'STORAGE_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES]

// Error history entry type
export type ErrorHistoryEntry = {
  code: ErrorCode
  message: string
  attemptAt: string // ISO timestamp
  retryCount: number // Which retry attempt this was (0-3)
}

/**
 * Download audio from YouTube using yt-dlp
 * Downloads and converts audio from YouTube video to MP3 format
 * @param track - Track object containing externalId and title
 * @param track.externalId - YouTube video ID
 * @param track.title - Track title for logging
 * @returns Promise resolving to the temporary file path of the downloaded audio
 * @throws {Error} If download fails or track data is invalid
 */
export async function downloadTrackAudio(track: { externalId: string; title: string }): Promise<string> {
  // Validate input
  if (!track || typeof track !== 'object') {
    throw new Error('Invalid track: must be an object')
  }
  
  if (!track.externalId || typeof track.externalId !== 'string') {
    throw new Error('Track has no valid externalId')
  }
  
  if (!track.title || typeof track.title !== 'string') {
    throw new Error('Track has no valid title')
  }

  const youtubeUrl = `https://www.youtube.com/watch?v=${track.externalId}`
  const outputPath = `/tmp/${track.externalId}.mp3`

  // Generate random sleep interval
  const sleepInterval = Math.floor(Math.random() * (SLEEP_INTERVAL_MAX - SLEEP_INTERVAL_MIN + 1)) + SLEEP_INTERVAL_MIN
  console.log(`Downloading ${track.title} with sleep interval: ${sleepInterval} seconds`)

  // Random user agent
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  ]
  const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)]

  try {
    const ytDlpArgs = [
      '-x', // Extract audio only
      '--audio-format', 'mp3',
      '--audio-quality', '0', // Best quality
      '-f', 'bestaudio',
      '--no-playlist',
      '--quiet',
      '--no-warnings',
      '--newline',
      '--sleep-interval', String(sleepInterval),
      '--max-sleep-interval', String(sleepInterval * 2),
      '--user-agent', randomUserAgent,
      '--embed-thumbnail',
      '--add-metadata',
      '--retries', '3',
      '--fragment-retries', '3',
      '-o', outputPath, youtubeUrl,
    ]


    // OAuth token removed - using yt-dlp without authentication
    
    await execa('yt-dlp', ytDlpArgs.filter((arg): arg is string => typeof arg === 'string'))

    // Check if file was created
    try {
      await readFile(outputPath)
      return outputPath
    } catch {
      throw new Error(`Download completed but file not found: ${outputPath}`)
    }
  } catch (error) {
    // Parse error message to determine error code
    let errorMessage = error instanceof Error ? error.message : String(error)
    let errorCode: ErrorCode = ERROR_CODES.UNKNOWN_ERROR
    
    // Extract more detailed error information from execa errors
    if (error && typeof error === 'object' && 'stderr' in error) {
      const execaError = error as any
      if (execaError.stderr) {
        errorMessage = execaError.stderr
      } else if (execaError.stdout) {
        errorMessage = execaError.stdout
      }
    }
    
    // Categorize errors based on content
    if (errorMessage.includes('Video unavailable') || errorMessage.includes('Private video') || errorMessage.includes('This video is not available')) {
      errorCode = ERROR_CODES.VIDEO_UNAVAILABLE
    } else if (errorMessage.includes('rate limit') || errorMessage.includes('429') || errorMessage.includes('Too Many Requests')) {
      errorCode = ERROR_CODES.RATE_LIMITED
    } else if (errorMessage.includes('network') || errorMessage.includes('timeout') || errorMessage.includes('connection') || errorMessage.includes('ConnectionError')) {
      errorCode = ERROR_CODES.NETWORK_ERROR
    } else if (errorMessage.includes('ffmpeg') || errorMessage.includes('conversion') || errorMessage.includes('Audio conversion failed')) {
      errorCode = ERROR_CODES.CONVERSION_FAILED
    } else if (errorMessage.includes('youtube') || errorMessage.includes('yt-dlp') || errorMessage.includes('invalid floating-point value')) {
      errorCode = ERROR_CODES.YOUTUBE_ERROR
    } else if (errorMessage.includes('Storage') || errorMessage.includes('upload') || errorMessage.includes('bucket')) {
      errorCode = ERROR_CODES.STORAGE_ERROR
    }

    // Clean up the error message for better readability
    const cleanMessage = errorMessage
      .replace(/Usage: yt-dlp.*?$/s, '') // Remove usage info
      .replace(/yt-dlp: error: /g, '') // Remove yt-dlp prefix
      .replace(/\n+/g, ' ') // Replace newlines with spaces
      .trim()

    throw new Error(`${errorCode}: ${cleanMessage}`)
  }
}

// Constants
const METADATA_MAX_LENGTH = 100
const METADATA_SAFE_CHARS_REGEX = /[^\w\s\-\.]/g
const NON_ASCII_REGEX = /[^\x20-\x7E]/g

/**
 * Sanitize metadata values for HTTP headers (remove invalid characters)
 * @param value - The string value to sanitize
 * @returns Sanitized string safe for HTTP headers
 */
function sanitizeForHeader(value: string): string {
  if (typeof value !== 'string') {
    return ''
  }
  
  return value
    .replace(NON_ASCII_REGEX, '') // Remove non-ASCII characters
    .replace(METADATA_SAFE_CHARS_REGEX, '') // Keep only word chars, spaces, hyphens, and dots
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim()
    .substring(0, METADATA_MAX_LENGTH) // Limit length
}

/**
 * Generate standardized metadata for audio files
 * @param track - Track object containing metadata
 * @param track.id - Track ID
 * @param track.title - Track title
 * @param track.artist - Track artist
 * @param track.externalId - External service ID
 * @param serviceName - Name of the service (e.g., 'youtube')
 * @returns Object containing sanitized metadata for storage
 */
function generateAudioMetadata(
  track: { id: string; title: string; artist: string; externalId: string },
  serviceName: string
): Record<string, string> {
  return {
    'track-id': track.id,
    'service': serviceName,
    'external-id': track.externalId,
    'title': sanitizeForHeader(track.title),
    'artist': sanitizeForHeader(track.artist),
  }
}

/**
 * Upload audio file to Tigris storage with metadata
 * Reads the file from disk and uploads it to S3-compatible storage
 * @param filePath - Path to the audio file on disk
 * @param track - Track object containing metadata
 * @param track.id - Track ID
 * @param track.title - Track title
 * @param track.artist - Track artist
 * @param track.externalId - External service ID
 * @param serviceName - Name of the service (e.g., 'youtube')
 * @returns Promise resolving to upload result with object key, filename, and size
 * @throws {Error} If file read or upload fails
 */
export async function uploadAudioToStorage(
  filePath: string,
  track: { id: string; title: string; artist: string; externalId: string },
  serviceName: string
): Promise<{ objectKey: string; fileName: string; fileSize: number }> {
  // Validate inputs
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Invalid filePath: must be a non-empty string')
  }
  
  if (!track || typeof track !== 'object') {
    throw new Error('Invalid track: must be an object')
  }
  
  if (!serviceName || typeof serviceName !== 'string') {
    throw new Error('Invalid serviceName: must be a non-empty string')
  }

  try {
    const fileBuffer = await readFile(filePath)
    const objectKey = `audio/${serviceName}/${track.id}.mp3`
    const fileName = `${track.title}.mp3`
    const metadata = generateAudioMetadata(track, serviceName)

    await uploadAudioFile(fileBuffer, objectKey, metadata)

    return {
      objectKey,
      fileName,
      fileSize: fileBuffer.length,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new Error(`${ERROR_CODES.STORAGE_ERROR}: Upload failed - ${errorMessage}`)
  }
}

/**
 * Add error to error history
 * Appends a new error entry to the existing error history JSON string
 * @param currentErrorHistory - Current error history JSON string or null
 * @param errorCode - Standardized error code
 * @param errorMessage - Human-readable error message
 * @param retryCount - Current retry attempt number
 * @returns Updated error history as JSON string
 */
export function addToErrorHistory(
  currentErrorHistory: string | null,
  errorCode: ErrorCode,
  errorMessage: string,
  retryCount: number
): string {
  const errorHistory: ErrorHistoryEntry[] = currentErrorHistory 
    ? (JSON.parse(currentErrorHistory) as ErrorHistoryEntry[])
    : []

  const newEntry: ErrorHistoryEntry = {
    code: errorCode,
    message: errorMessage,
    attemptAt: new Date().toISOString(),
    retryCount,
  }

  errorHistory.push(newEntry)
  return JSON.stringify(errorHistory)
}

/**
 * Get current error from error history
 * Extracts the most recent error entry from the error history JSON
 * @param errorHistory - Error history JSON string or null
 * @returns Most recent error entry or null if no errors exist
 */
export function getCurrentError(errorHistory: string | null): ErrorHistoryEntry | null {
  if (!errorHistory) return null
  
  try {
    const errors: ErrorHistoryEntry[] = JSON.parse(errorHistory) as ErrorHistoryEntry[]
    return errors[errors.length - 1] || null
  } catch {
    return null
  }
}

/**
 * Main function to archive a track's audio
 * Downloads audio from YouTube, uploads to storage, and updates database
 * Handles error tracking, retry logic, and cleanup
 * @param trackId - The ID of the track to archive
 * @returns Promise that resolves when archiving is complete
 * @throws {Error} If trackId is invalid or track not found
 */
export async function archiveTrackAudio(trackId: string): Promise<void> {
  // Validate input
  if (!trackId || typeof trackId !== 'string' || trackId.trim().length === 0) {
    throw new Error('Invalid trackId: must be a non-empty string')
  }

  const track = await prisma.track.findUnique({
    where: { id: trackId },
    include: {
      service: true,
      audioFile: true,
    },
  })

  if (!track) {
    throw new Error(`Track not found: ${trackId}`)
  }

  if (!track.externalId) {
    throw new Error(`Track has no externalId: ${trackId}`)
  }

  if (!track.service) {
    throw new Error(`Track has no service: ${trackId}`)
  }

  // Update status to processing
  await prisma.trackAudioFile.update({
    where: { trackId },
    data: {
      status: 'processing',
      lastAttemptAt: new Date(),
    },
  })

  // Update worker state processing count
  try {
    await prisma.workerState.update({
      where: { id: 'singleton' },
      data: {
        currentlyProcessing: { increment: 1 },
      },
    })
  } catch (error) {
    console.error('Failed to update worker state processing count:', error)
    throw error // Re-throw to prevent processing if we can't track it
  }

  let tempFilePath: string | null = null

  try {
    // Download audio
    tempFilePath = await downloadTrackAudio({ externalId: track.externalId, title: track.title })
    
    // Extract duration from the downloaded audio file
    const duration = await extractAudioDuration(tempFilePath)
    
    // Upload to storage
    const uploadResult = await uploadAudioToStorage(
      tempFilePath,
      { id: track.id, title: track.title, artist: track.artist, externalId: track.externalId },
      track.service.name
    )

    // Update database with success and duration
    await prisma.$transaction([
      // Update track with duration
      prisma.track.update({
        where: { id: trackId },
        data: { duration }
      }),
      // Update audio file with success
      prisma.trackAudioFile.update({
        where: { trackId },
        data: {
          status: 'completed',
          objectKey: uploadResult.objectKey,
          fileName: uploadResult.fileName,
          fileSize: uploadResult.fileSize,
          mimeType: 'audio/mpeg',
          downloadedAt: new Date(),
          lastAttemptAt: new Date(),
          // Clear error history on success
          errorHistory: null,
          retryCount: 0,
        },
      })
    ])

    console.log(`Successfully archived track ${trackId}: ${uploadResult.fileName}`)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorCode = errorMessage.split(':')[0] as ErrorCode
    const cleanErrorMessage = errorMessage.includes(':') ? errorMessage.split(':').slice(1).join(':').trim() : errorMessage

    // Get current audio file to update retry count
    const audioFile = await prisma.trackAudioFile.findUnique({
      where: { trackId },
    })

    if (!audioFile) {
      throw new Error(`AudioFile not found for track: ${trackId}`)
    }

    const newRetryCount = audioFile.retryCount + 1
    const errorHistory = addToErrorHistory(
      audioFile.errorHistory,
      errorCode,
      cleanErrorMessage,
      newRetryCount
    )

    // Determine if this should be marked as failed (max retries reached)
    const shouldFail = newRetryCount >= 3

    await prisma.trackAudioFile.update({
      where: { trackId },
      data: {
        status: shouldFail ? 'failed' : 'pending',
        errorHistory,
        retryCount: newRetryCount,
        lastAttemptAt: new Date(),
      },
    })

    console.error(`Failed to archive track ${trackId} (attempt ${newRetryCount}): ${errorMessage}`)
    
    if (shouldFail) {
      console.error(`Track ${trackId} marked as permanently failed after ${newRetryCount} attempts`)
    }
  } finally {
    // Clean up temp file
    if (tempFilePath) {
      try {
        await unlink(tempFilePath)
      } catch (error) {
        console.warn(`Failed to delete temp file ${tempFilePath}:`, error)
      }
    }

    // Update worker state processing count
    try {
      await prisma.workerState.update({
        where: { id: 'singleton' },
        data: {
          currentlyProcessing: { decrement: 1 },
        },
      })
    } catch (error) {
      console.error('Failed to update worker state processing count:', error)
    }
  }
}
