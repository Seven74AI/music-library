import { prisma } from '#app/utils/db.server'

// Constants
const LONG_BREAK_INTERVAL_HOURS = [6, 8] // Random 6-8h
// const LONG_BREAK_DURATION_HOURS = [3, 4] // Random 3-4h pause - TODO: Implement long break functionality

/**
 * Calculate next long break time (random 6-8 hours from now)
 */
export function calculateNextLongBreak(): Date {
  const now = new Date()
  const minHours = LONG_BREAK_INTERVAL_HOURS[0]
  const maxHours = LONG_BREAK_INTERVAL_HOURS[1]
  
  if (minHours === undefined || maxHours === undefined) {
    throw new Error('LONG_BREAK_INTERVAL_HOURS must have at least 2 elements')
  }
  
  const randomHours = minHours + Math.random() * (maxHours - minHours)
  
  return new Date(now.getTime() + randomHours * 60 * 60 * 1000)
}

/**
 * Pause the worker gracefully
 */
export async function pauseWorker(): Promise<{ success: boolean; message: string }> {
  const workerState = await prisma.workerState.findUnique({
    where: { id: 'singleton' },
  })

  if (!workerState) {
    return { success: false, message: 'WorkerState not found' }
  }

  if (workerState.status === 'paused') {
    return { success: true, message: 'Worker is already paused' }
  }

  // Set status to paused
  await prisma.workerState.update({
    where: { id: 'singleton' },
    data: {
      status: 'paused',
      lastStateChange: new Date(),
    },
  })

  // Wait for current downloads to finish (with timeout)
  const maxWaitTime = 10 * 60 * 1000 // 10 minutes
  const checkInterval = 5 * 1000 // 5 seconds
  let waited = 0

  while (waited < maxWaitTime) {
    const currentState = await prisma.workerState.findUnique({
      where: { id: 'singleton' },
      select: { currentlyProcessing: true },
    })

    if (!currentState || currentState.currentlyProcessing === 0) {
      return { success: true, message: 'Worker paused successfully' }
    }

    await new Promise(resolve => setTimeout(resolve, checkInterval))
    waited += checkInterval
  }

  return { 
    success: true, 
    message: `Worker paused, but ${workerState.currentlyProcessing} downloads are still completing` 
  }
}

/**
 * Resume the worker
 */
export async function resumeWorker(): Promise<{ success: boolean; message: string }> {
  const workerState = await prisma.workerState.findUnique({
    where: { id: 'singleton' },
  })

  if (!workerState) {
    return { success: false, message: 'WorkerState not found' }
  }

  if (workerState.status === 'running') {
    return { success: true, message: 'Worker is already running' }
  }

  const nextLongBreak = calculateNextLongBreak()

  await prisma.workerState.update({
    where: { id: 'singleton' },
    data: {
      status: 'running',
      lastStateChange: new Date(),
      nextLongBreakAt: nextLongBreak,
    },
  })

  return { 
    success: true, 
    message: `Worker resumed. Next long break scheduled for ${nextLongBreak.toISOString()}` 
  }
}

/**
 * Break a long pause early
 */
export async function breakLongPause(): Promise<{ success: boolean; message: string }> {
  const workerState = await prisma.workerState.findUnique({
    where: { id: 'singleton' },
  })

  if (!workerState) {
    return { success: false, message: 'WorkerState not found' }
  }

  if (workerState.status !== 'long_break') {
    return { success: false, message: 'Worker is not in long break' }
  }

  const nextLongBreak = calculateNextLongBreak()

  await prisma.workerState.update({
    where: { id: 'singleton' },
    data: {
      status: 'running',
      lastStateChange: new Date(),
      nextLongBreakAt: nextLongBreak,
    },
  })

  return { 
    success: true, 
    message: `Long break ended early. Next long break scheduled for ${nextLongBreak.toISOString()}` 
  }
}

/**
 * Get worker status with additional info
 */
export async function getWorkerStatus() {
  const workerState = await prisma.workerState.findUnique({
    where: { id: 'singleton' },
  })

  if (!workerState) {
    return {
      status: 'unknown',
      message: 'WorkerState not found',
      currentlyProcessing: 0,
      lastQueueRun: null,
      nextLongBreakAt: null,
      lastStateChange: null,
    }
  }

  let message = ''
  let timeUntilNextBreak: string | null = null

  switch (workerState.status) {
    case 'running':
      message = 'Worker is running normally'
      if (workerState.nextLongBreakAt) {
        const now = new Date()
        const timeDiff = workerState.nextLongBreakAt.getTime() - now.getTime()
        if (timeDiff > 0) {
          const hours = Math.floor(timeDiff / (1000 * 60 * 60))
          const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60))
          timeUntilNextBreak = `${hours}h ${minutes}m`
        }
      }
      break
    case 'paused':
      message = 'Worker is paused'
      break
    case 'long_break':
      message = 'Worker is in automatic long break'
      break
  }

  return {
    status: workerState.status,
    message,
    currentlyProcessing: workerState.currentlyProcessing,
    lastQueueRun: workerState.lastQueueRun,
    nextLongBreakAt: workerState.nextLongBreakAt,
    lastStateChange: workerState.lastStateChange,
    timeUntilNextBreak,
  }
}

/**
 * Clean up tracks stuck in processing status (called on server startup)
 */
export async function cleanupStuckTracks(): Promise<{ cleaned: number }> {
  const stuckTracks = await prisma.trackAudioFile.findMany({
    where: { status: 'processing' },
    select: { trackId: true },
  })

  if (stuckTracks.length === 0) {
    return { cleaned: 0 }
  }

  await prisma.trackAudioFile.updateMany({
    where: { status: 'processing' },
    data: {
      status: 'pending',
      lastAttemptAt: null,
    },
  })

  // Reset worker state processing count
  await prisma.workerState.update({
    where: { id: 'singleton' },
    data: {
      currentlyProcessing: 0,
    },
  })

  console.log(`Cleaned up ${stuckTracks.length} stuck tracks`)
  return { cleaned: stuckTracks.length }
}

/**
 * Reset a track for retry (admin function)
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
 * Initialize worker state if it doesn't exist
 */
export async function initializeWorkerState(): Promise<void> {
  const existingState = await prisma.workerState.findUnique({
    where: { id: 'singleton' },
  })

  if (!existingState) {
    const nextLongBreak = calculateNextLongBreak()
    
    await prisma.workerState.create({
      data: {
        id: 'singleton',
        status: 'running',
        lastStateChange: new Date(),
        nextLongBreakAt: nextLongBreak,
        currentlyProcessing: 0,
      },
    })

    console.log('Initialized WorkerState with running status')
  }
}
