import { type Prisma } from '@prisma/client'
import { redirect } from 'react-router'

import { prisma } from './db.server'
import { extractYouTubeVideoId } from './track-validation.server'
import { YouTubeAPIError } from './youtube-errors'
import { getYouTubeVideoDetails } from './youtube-search.server'

// Generic service API error
export class ServiceAPIError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number
  ) {
    super(message)
    this.name = 'ServiceAPIError'
  }
}

// Service import handler interface - designed for easy extension
export interface ServiceImportHandler {
  validateUrl(url: string): string | null // Returns video/track ID or null if invalid
  getVideoDetails(videoId: string): Promise<{
    id: string
    title: string
    artist: string
    duration: number
    thumbnailUrl: string
    serviceUrl: string
    publishedAt: string
  }>
  getImportUrl(serviceName: string, videoId: string): string
}

// YouTube service handler - the only implemented service for now
const youtubeImportHandler: ServiceImportHandler = {
  validateUrl(url: string): string | null {
    return extractYouTubeVideoId(url)
  },

  async getVideoDetails(videoId: string) {
    try {
      const details = await getYouTubeVideoDetails(videoId)
      return {
        id: details.id,
        title: details.title,
        artist: details.artist,
        duration: details.duration,
        thumbnailUrl: details.thumbnailUrl,
        serviceUrl: details.serviceUrl,
        publishedAt: details.publishedAt,
      }
    } catch (error) {
      if (error instanceof YouTubeAPIError) {
        throw new ServiceAPIError(error.message, error.code, error.statusCode)
      }
      throw new ServiceAPIError('Failed to fetch video details', 'FETCH_FAILED', 500)
    }
  },

  getImportUrl(serviceName: string, videoId: string): string {
    return `/music/services/youtube/import?videoId=${videoId}`
  }
}

// Service handlers registry - easy to extend with new services
const serviceHandlers: Record<string, ServiceImportHandler> = {
  youtube: youtubeImportHandler,
  // Future services can be added here:
  // spotify: spotifyImportHandler,
  // apple_music: appleMusicImportHandler,
  // soundcloud: soundcloudImportHandler,
}

/**
 * Get the import handler for a specific service
 */
export function getServiceImportHandler(serviceName: string): ServiceImportHandler {
  const handler = serviceHandlers[serviceName]
  if (!handler) {
    throw new ServiceAPIError(`Unsupported service: ${serviceName}`, 'UNSUPPORTED_SERVICE', 400)
  }
  return handler
}

/**
 * Process a service import request - generic function that works with any service
 */
export async function processServiceImport(serviceName: string, url: string): Promise<Response> {
  const handler = getServiceImportHandler(serviceName)
  
  // Validate URL and extract ID
  const videoId = handler.validateUrl(url)
  if (!videoId) {
    throw new ServiceAPIError(`Invalid ${serviceName} URL format`, 'INVALID_URL', 400)
  }
  
  // Verify the video/track exists by getting its details
  await handler.getVideoDetails(videoId)
  
  // Redirect to the service-specific import route
  const importUrl = handler.getImportUrl(serviceName, videoId)
  return redirect(importUrl)
}

/**
 * Import a track directly without redirecting - for use in action functions
 */
export async function importTrackDirectly(serviceName: string, videoId: string, userId: string): Promise<{
  success: boolean
  track?: Prisma.TrackGetPayload<{}>
  error?: string
  errorType?: string
  trackId?: string
}> {
  const handler = getServiceImportHandler(serviceName)
  
  try {
    // Get video details
    const videoDetails = await handler.getVideoDetails(videoId)
    
    // Get the service
    const service = await prisma.service.findUnique({
      where: { name: serviceName }
    })
    
    if (!service) {
      console.error(`Service not found in importTrackDirectly: ${serviceName}`)
      return { success: false, error: `Service not found: ${serviceName}` }
    }
    
    // Check if track already exists globally
    let track = await prisma.track.findUnique({
      where: {
        serviceId_serviceProviderId: {
          serviceId: service.id,
          serviceProviderId: videoId
        }
      }
    })
    
    // If track doesn't exist, create it
    if (!track) {
      const { createId } = await import('@paralleldrive/cuid2')
      
      // Prepare track data (Prisma handles validation)
      const trackData: Prisma.TrackCreateInput = {
        title: videoDetails.title,
        artist: videoDetails.artist,
        album: null,
        duration: videoDetails.duration,
        serviceProviderId: videoId,
        service: { connect: { id: service.id } },
        serviceUrl: videoDetails.serviceUrl,
        thumbnailUrl: videoDetails.thumbnailUrl,
        releaseDate: null,
      }
      
      track = await prisma.track.create({
        data: {
          id: createId(),
          ...trackData,
        }
      })
    }
    
    // Check if user already has this track
    const existingUserTrack = await prisma.userTrack.findUnique({
      where: {
        userId_trackId: {
          userId: userId,
          trackId: track.id
        }
      }
    })
    
    if (existingUserTrack) {
      return { 
        success: false, 
        error: `"${track.title}" is already in your library.`,
        errorType: 'ALREADY_EXISTS',
        trackId: track.id
      }
    }
    
    // Add track to user's library
    const { createId } = await import('@paralleldrive/cuid2')
    
    // Create user track (Prisma handles validation)
    await prisma.userTrack.create({
      data: {
        id: createId(),
        user: { connect: { id: userId } },
        track: { connect: { id: track.id } }
      }
    })
    
    return { success: true, track }
    
  } catch (error) {
    console.error('Error importing track:', error)
    return { 
      success: false, 
      error: 'Failed to import track. Please try again.' 
    }
  }
}
