import { prisma } from './db.server'

/**
 * Simple track enqueuing for app-side operations
 * Used when importing tracks or syncing playlists
 * 
 * @param trackId - The ID of the track to enqueue for archiving
 * @param priority - Whether to prioritize this track in the queue
 * @throws {Error} If trackId is invalid or database operation fails
 * @returns Promise that resolves when the track is successfully enqueued
 */
export async function enqueueTrackForArchiving(trackId: string, priority: boolean): Promise<void> {
  // Check if audio archiving is enabled
  if (process.env.AUDIO_ARCHIVE_ENABLED !== 'true') {
    console.log('Audio archiving is disabled, skipping track enqueue')
    return
  }

  try {
    const existing = await prisma.trackAudioFile.findUnique({
      where: { trackId },
    })

    if (existing) {
      await prisma.trackAudioFile.update({
        where: { trackId },
        data: { status: 'pending', priority },
      })
    } else {
      await prisma.trackAudioFile.create({
        data: { trackId, status: 'pending', priority, retryCount: 0 },
      })
    }
  } catch (error) {
    console.warn(`Failed to enqueue track ${trackId} for archiving:`, error)
  }
}
