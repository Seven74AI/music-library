/**
 * Frontend Statistics Types
 * 
 * This file defines type-safe interfaces for statistics and dashboard components.
 * 
 * @example
 * ```typescript
 * import { type YouTubeStats, type MusicStats } from '#app/types/frontend/stats'
 * 
 * const stats: MusicStats = useLoaderData()
 * ```
 */

// Import types from other frontend modules
import { type PlaylistSummary } from './playlists'
import { type TrackWithUserStatus } from './shared'

// ============================================================================
// STATISTICS TYPES
// ============================================================================

/**
 * YouTube service statistics for dashboard
 */
export interface YouTubeStats {
  totalPlaylists: number
  totalTracks: number
  lastSync: Date | null
  isConnected: boolean
}

/**
 * General music library statistics
 */
export interface MusicStats {
  totalTracks: number
  totalPlaylists: number
  totalDuration: number
  recentTracks: TrackWithUserStatus[]
  recentPlaylists: PlaylistSummary[]
}
