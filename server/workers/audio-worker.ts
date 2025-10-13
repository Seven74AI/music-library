import { prisma } from '../utils/db.js'

import { processQueue } from '../workers/audio-queue.js'
import { 
  cleanupStuckTracks, 
  initializeWorkerState, 
  calculateNextLongBreak 
} from '../workers/audio-worker-control.js'

// Constants
const LONG_BREAK_DURATION_HOURS = [1, 2] // Random 1-2h pause
const DEFAULT_INTERVAL_MS = 2 * 60 * 1000 // 2 minutes
const MAX_WAIT_TIME_MS = 5 * 60 * 1000 // 5 minutes
const CHECK_INTERVAL_MS = 5 * 1000 // 5 seconds

let workerInterval: NodeJS.Timeout | null = null
let isShuttingDown = false

/**
 * Get interval from environment or use default
 * @returns The interval in milliseconds for worker execution
 */
function getIntervalMs(): number {
  const envInterval = process.env.AUDIO_ARCHIVE_INTERVAL_MS
  if (envInterval) {
    const parsed = parseInt(envInterval, 10)
    if (!isNaN(parsed) && parsed > 0) {
      return parsed
    }
  }
  return DEFAULT_INTERVAL_MS
}

/**
 * Check if long break is due and handle it
 * @returns Promise resolving to true if a long break was handled, false otherwise
 */
async function handleLongBreak(): Promise<boolean> {
  const workerState = await prisma.workerState.findUnique({
    where: { id: 'singleton' },
  })

  if (!workerState) {
    console.warn('WorkerState not found during long break check')
    return false
  }

  // Check if long break is due
  if (workerState.nextLongBreakAt && new Date() >= workerState.nextLongBreakAt) {
    console.log('Long break is due, waiting for current downloads to finish...')
    
    // Wait for current downloads to finish
    let waited = 0

    while (waited < MAX_WAIT_TIME_MS && workerState.currentlyProcessing > 0) {
      const currentState = await prisma.workerState.findUnique({
        where: { id: 'singleton' },
        select: { currentlyProcessing: true },
      })

      if (!currentState || currentState.currentlyProcessing === 0) {
        break
      }

      await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL_MS))
      waited += CHECK_INTERVAL_MS
    }

    // Set status to long_break
    await prisma.workerState.update({
      where: { id: 'singleton' },
      data: {
        status: 'long_break',
        lastStateChange: new Date(),
      },
    })

    console.log('Worker entered long break mode')

    // Calculate break duration (random 3-4 hours)
    const minHours = LONG_BREAK_DURATION_HOURS[0]
    const maxHours = LONG_BREAK_DURATION_HOURS[1]
    
    if (minHours === undefined || maxHours === undefined) {
      throw new Error('LONG_BREAK_DURATION_HOURS must have at least 2 elements')
    }
    
    const breakDurationMs = (minHours + Math.random() * (maxHours - minHours)) * 60 * 60 * 1000

    console.log(`Long break duration: ${Math.round(breakDurationMs / (60 * 60 * 1000) * 10) / 10} hours`)

    // Polling approach to allow admin interruption
    const startTime = Date.now()
    const checkInterval = 30 * 1000 // Check every 30 seconds
    
    while (Date.now() - startTime < breakDurationMs) {
      // Check if admin wants to break the pause
      const currentState = await prisma.workerState.findUnique({
        where: { id: 'singleton' },
        select: { status: true },
      })
      
      if (currentState?.status !== 'long_break') {
        console.log('Long break interrupted by admin')
        return true
      }
      
      // Sleep for a shorter interval
      await new Promise(resolve => setTimeout(resolve, checkInterval))
    }

    // Calculate next long break time
    const nextLongBreak = calculateNextLongBreak()

    // Resume worker
    await prisma.workerState.update({
      where: { id: 'singleton' },
      data: {
        status: 'running',
        lastStateChange: new Date(),
        nextLongBreakAt: nextLongBreak,
      },
    })

    console.log(`Long break ended. Next long break scheduled for ${nextLongBreak.toISOString()}`)
    return true
  }

  return false
}

/**
 * Main worker loop that processes the audio queue
 * Handles long breaks and queue processing based on worker state
 * @returns Promise that resolves when the loop iteration completes
 */
async function workerLoop(): Promise<void> {
  if (isShuttingDown) {
    return
  }

  try {
    // Check if long break is due
    const wasInLongBreak = await handleLongBreak()
    
    if (wasInLongBreak) {
      // Long break just ended, process queue immediately
      console.log('Processing queue after long break...')
      await processQueue()
      return
    }

    // Check worker status
    const workerState = await prisma.workerState.findUnique({
      where: { id: 'singleton' },
    })

    if (!workerState) {
      console.warn('WorkerState not found, skipping queue processing')
      return
    }

    if (workerState.status === 'running') {
      await processQueue()
    } else {
      console.log(`Worker status is ${workerState.status}, skipping queue processing`)
    }
  } catch (error) {
    console.error('Error in worker loop:', error)
  }
}

/**
 * Start the background audio archive worker
 * Initializes worker state, cleans up stuck tracks, and starts the processing loop
 * @returns Promise that resolves when the worker is successfully started
 */
export async function startAudioWorker(): Promise<void> {
  // Check if audio archiving is enabled
  if (process.env.AUDIO_ARCHIVE_ENABLED !== 'true') {
    console.log('Audio archiving is disabled via AUDIO_ARCHIVE_ENABLED environment variable')
    return
  }

  console.log('Starting audio archive worker...')

  try {
    // Initialize worker state
    await initializeWorkerState()

    // Clean up any stuck tracks from previous runs
    const cleanupResult = await cleanupStuckTracks()
    if (cleanupResult.cleaned > 0) {
      console.log(`Cleaned up ${cleanupResult.cleaned} stuck tracks from previous run`)
    }

    // Get worker state to determine if we should start
    const workerState = await prisma.workerState.findUnique({
      where: { id: 'singleton' },
    })

    if (!workerState) {
      console.error('Failed to initialize WorkerState')
      return
    }

    console.log(`Worker state: ${workerState.status}`)

    // Start interval timer based on worker state
    if (workerState.status === 'running') {
      const intervalMs = getIntervalMs()
      console.log(`Starting worker with ${intervalMs}ms interval`)
      
      workerInterval = setInterval(workerLoop, intervalMs)
      
      // Process queue immediately on startup
      console.log('Processing initial queue...')
      await processQueue()
    } else {
      console.log(`Worker is ${workerState.status}, not starting interval timer`)
    }

    console.log('Audio archive worker started successfully')
  } catch (error) {
    console.error('Failed to start audio worker:', error)
  }
}

/**
 * Stop the background worker gracefully
 * Waits for current downloads to complete before stopping
 * @returns Promise that resolves when the worker is successfully stopped
 */
export async function stopAudioWorker(): Promise<void> {
  console.log('Stopping audio archive worker...')
  
  isShuttingDown = true

  // Stop interval timer
  if (workerInterval) {
    clearInterval(workerInterval)
    workerInterval = null
  }

  // Wait for current downloads to finish
  let waited = 0

  while (waited < MAX_WAIT_TIME_MS) {
    const workerState = await prisma.workerState.findUnique({
      where: { id: 'singleton' },
      select: { currentlyProcessing: true },
    })

    if (!workerState || workerState.currentlyProcessing === 0) {
      break
    }

    console.log(`Waiting for ${workerState.currentlyProcessing} downloads to complete...`)
    await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL_MS))
    waited += CHECK_INTERVAL_MS
  }

  if (waited >= MAX_WAIT_TIME_MS) {
    console.warn('Timeout waiting for downloads to complete')
  }

  console.log('Audio archive worker stopped')
}

/**
 * Restart the worker (useful for configuration changes)
 * Stops the current worker and starts a new one
 * @returns Promise that resolves when the worker is successfully restarted
 */
export async function restartAudioWorker(): Promise<void> {
  console.log('Restarting audio archive worker...')
  await stopAudioWorker()
  isShuttingDown = false
  await startAudioWorker()
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully...')
  await stopAudioWorker()
  process.exit(0)
})

process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down gracefully...')
  await stopAudioWorker()
  process.exit(0)
})
