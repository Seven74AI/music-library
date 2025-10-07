import { YOUTUBE_CONSTANTS } from '../config/youtube'
import { getBestThumbnailUrl } from './youtube-utils'
import { createYouTubeService } from './youtube.server'

// Common types for music services
export interface Playlist {
  id: string
  title: string
  description?: string
  thumbnailUrl?: string
  channelId: string
  channelTitle: string
  publishedAt: string
  itemCount: number
}

export interface PlaylistItem {
  contentDetails: {
    videoId: string
  }
  snippet: {
    title: string
    channelTitle: string
    videoOwnerChannelTitle?: string
    thumbnails?: {
      default?: { url: string }
      medium?: { url: string }
      high?: { url: string }
      standard?: { url: string }
      maxres?: { url: string }
    }
  }
}

export interface PlaylistDetails {
  snippet: {
    title: string
    description?: string
    channelId: string
    channelTitle: string
    publishedAt: string
    thumbnails?: {
      default?: { url: string }
      medium?: { url: string }
      high?: { url: string }
      standard?: { url: string }
      maxres?: { url: string }
    }
  }
  contentDetails: {
    itemCount: number
  }
}

export interface PlaylistsResponse {
  items: Playlist[]
}

// Common interface for all music services
export interface MusicService {
  name: string
  getUserPlaylists(accessToken: string): Promise<PlaylistsResponse>
  getPlaylistItems(playlistId: string, accessToken: string): Promise<PlaylistItem[]>
  getPlaylist(playlistId: string, accessToken: string): Promise<PlaylistDetails>
}

// YouTube service adapter to match our common interface
class YouTubeServiceAdapter implements MusicService {
  private youtubeService: ReturnType<typeof createYouTubeService>
  
  constructor() {
    this.youtubeService = createYouTubeService()
  }
  
  get name() {
    return 'youtube'
  }
  
  async getUserPlaylists(accessToken: string): Promise<PlaylistsResponse> {
    const response = await this.youtubeService.getUserPlaylists(accessToken)
    return {
      items: response.items.map(item => ({
        id: item.id,
        title: item.snippet.title,
        description: item.snippet.description,
        thumbnailUrl: getBestThumbnailUrl(item.snippet.thumbnails) || undefined,
        channelId: item.snippet.channelId,
        channelTitle: item.snippet.channelTitle,
        publishedAt: item.snippet.publishedAt,
        itemCount: item.contentDetails?.itemCount || 0
      }))
    }
  }
  
  async getPlaylistItems(playlistId: string, accessToken: string): Promise<PlaylistItem[]> {
    return this.youtubeService.getPlaylistItems(playlistId, accessToken)
  }
  
  async getPlaylist(playlistId: string, accessToken: string): Promise<PlaylistDetails> {
    return this.youtubeService.getPlaylist(playlistId, accessToken)
  }
}

// Service factory to create service instances
export function createMusicService(serviceName: string): MusicService {
  switch (serviceName) {
    case 'youtube':
      return new YouTubeServiceAdapter()
    case 'spotify':
      throw new Error('Spotify service not implemented yet')
    case 'apple_music':
      throw new Error('Apple Music service not implemented yet')
    default:
      throw new Error(`Unknown service: ${serviceName}`)
  }
}

// Helper to get service display name
export function getServiceDisplayName(serviceName: string): string {
  switch (serviceName) {
    case 'youtube':
      return 'YouTube'
    case 'spotify':
      return 'Spotify'
    case 'apple_music':
      return 'Apple Music'
    default:
      return serviceName.charAt(0).toUpperCase() + serviceName.slice(1)
  }
}

// Helper to get service base URL
export function getServiceBaseUrl(serviceName: string): string {
  switch (serviceName) {
    case 'youtube':
      return YOUTUBE_CONSTANTS.BASE_URL
    case 'spotify':
      return 'https://spotify.com'
    case 'apple_music':
      return 'https://music.apple.com'
    default:
      return 'https://example.com'
  }
}
