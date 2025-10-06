import { prisma } from '#app/utils/db.server'
import { createYouTubeOAuthService, validateYouTubeTokens } from '#app/utils/youtube-oauth.server'
import { createYouTubeService, transformYouTubePlaylist } from '#app/utils/youtube.server'

// Type for stored token data
type StoredTokenData = {
  youtubeUserId: string
  accessToken: string
  refreshToken?: string
  expiryDate?: number
}

export class YouTubePlaylistService {
  /**
   * Get all YouTube playlists for a user
   */
  async getUserPlaylists(userId: string) {
    return prisma.youTubePlaylist.findMany({
      where: {
        ownerId: userId,
        isActive: true,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    })
  }

  /**
   * Get a specific YouTube playlist by ID
   */
  async getPlaylist(playlistId: string, userId: string) {
    return prisma.youTubePlaylist.findFirst({
      where: {
        id: playlistId,
        ownerId: userId,
      },
    })
  }

  /**
   * Get YouTube user info
   */
  async getYouTubeUserInfo(accessToken: string) {
    const youtubeService = createYouTubeService()
    return youtubeService.getYouTubeUserInfo(accessToken)
  }

  /**
   * Get stored YouTube tokens for user
   */
  async getStoredTokens(userId: string): Promise<{ accessToken: string; refreshToken?: string; expiryDate?: number } | null> {
    const connection = await prisma.connection.findFirst({
      where: {
        providerName: 'youtube',
        userId: userId,
      },
    })
    
    if (!connection || !connection.tokens) {
      return null
    }

    try {
      const tokenData = JSON.parse(connection.tokens) as StoredTokenData
      
      // Check if token is expired
      if (tokenData.expiryDate && Date.now() > tokenData.expiryDate) {
        // Token expired, try to refresh if we have refresh token
        if (tokenData.refreshToken) {
          try {
            const oauthService = createYouTubeOAuthService()
            const newTokens = await oauthService.refreshAccessToken(tokenData.refreshToken)
            
            // Update stored tokens
            await prisma.connection.update({
              where: { id: connection.id },
              data: {
                tokens: JSON.stringify({
                  ...tokenData,
                  accessToken: newTokens.access_token,
                  expiryDate: newTokens.expiry_date,
                } as StoredTokenData),
                updatedAt: new Date(),
              },
            })
            
            return {
              accessToken: newTokens.access_token,
              refreshToken: tokenData.refreshToken,
              expiryDate: newTokens.expiry_date,
            }
          } catch (error) {
            console.error('Failed to refresh token:', error)
            return null
          }
        } else {
          return null
        }
      }
      
      return {
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        expiryDate: tokenData.expiryDate,
      }
    } catch (error) {
      console.error('Error parsing stored tokens:', error)
      return null
    }
  }

  /**
   * Sync user's YouTube playlists
   */
  async syncUserPlaylists(userId: string, accessToken?: string) {
    try {
      // Get stored tokens if no access token provided
      let tokenToUse = accessToken
      if (!tokenToUse) {
        const storedTokens = await this.getStoredTokens(userId)
        if (!storedTokens) {
          throw new Error('No YouTube tokens found. Please authenticate first.')
        }
        tokenToUse = storedTokens.accessToken
      }

      // Validate tokens first
      const isValid = await validateYouTubeTokens({ access_token: tokenToUse })
      if (!isValid) {
        throw new Error('Invalid YouTube access token')
      }

      const youtubeService = createYouTubeService()
      let nextPageToken: string | undefined
      let totalSynced = 0

      do {
        // Fetch playlists from YouTube API
        const response = await youtubeService.getUserPlaylists(tokenToUse, 50, nextPageToken)
        
        for (const playlist of response.items) {
          try {
            // Transform YouTube playlist data
            const playlistData = transformYouTubePlaylist(playlist, userId)
            
            // Upsert playlist (update if exists, create if not, restore if deleted)
            await prisma.youTubePlaylist.upsert({
              where: {
                youtubeId: playlist.id,
              },
              update: {
                ...playlistData,
                lastSyncedAt: new Date(),
                isActive: true, // Restore deleted playlists
              },
              create: {
                ...playlistData,
                lastSyncedAt: new Date(),
                isActive: true,
              },
            })
            
            totalSynced++
          } catch (error) {
            console.error(`Error syncing playlist ${playlist.id}:`, error)
            // Continue with other playlists even if one fails
          }
        }
        
        nextPageToken = response.nextPageToken
      } while (nextPageToken)

      return {
        success: true,
        totalSynced,
        message: `Successfully synced ${totalSynced} playlists`,
      }
    } catch (error) {
      console.error('Error syncing YouTube playlists:', error)
      throw new Error('Failed to sync YouTube playlists')
    }
  }

  /**
   * Remove a YouTube playlist from user's synced playlists
   */
  async removePlaylist(playlistId: string, userId: string) {
    const playlist = await prisma.youTubePlaylist.findFirst({
      where: {
        id: playlistId,
        ownerId: userId,
      },
    })

    if (!playlist) {
      throw new Error('Playlist not found')
    }

    // Soft delete by setting isActive to false
    await prisma.youTubePlaylist.update({
      where: {
        id: playlistId,
      },
      data: {
        isActive: false,
      },
    })

    return {
      success: true,
      message: 'Playlist removed successfully',
    }
  }

  /**
   * Restore a previously removed playlist
   */
  async restorePlaylist(playlistId: string, userId: string) {
    const playlist = await prisma.youTubePlaylist.findFirst({
      where: {
        id: playlistId,
        ownerId: userId,
      },
    })

    if (!playlist) {
      throw new Error('Playlist not found')
    }

    await prisma.youTubePlaylist.update({
      where: {
        id: playlistId,
      },
      data: {
        isActive: true,
      },
    })

    return {
      success: true,
      message: 'Playlist restored successfully',
    }
  }

  /**
   * Get playlist sync status
   */
  async getSyncStatus(userId: string) {
    const playlists = await prisma.youTubePlaylist.findMany({
      where: {
        ownerId: userId,
      },
      select: {
        id: true,
        title: true,
        lastSyncedAt: true,
        isActive: true,
      },
    })

    const activePlaylists = playlists.filter(p => p.isActive)
    const lastSync = activePlaylists.reduce((latest, playlist) => {
      if (!playlist.lastSyncedAt) return latest
      if (!latest) return playlist.lastSyncedAt
      return playlist.lastSyncedAt > latest ? playlist.lastSyncedAt : latest
    }, null as Date | null)

    return {
      totalPlaylists: activePlaylists.length,
      lastSync,
      playlists: activePlaylists.map(p => ({
        id: p.id,
        title: p.title,
        lastSyncedAt: p.lastSyncedAt,
      })),
    }
  }

  /**
   * Update playlist data from YouTube API
   */
  async updatePlaylistFromYouTube(playlistId: string, userId: string, accessToken?: string) {
    const playlist = await prisma.youTubePlaylist.findFirst({
      where: {
        id: playlistId,
        ownerId: userId,
      },
    })

    if (!playlist) {
      throw new Error('Playlist not found')
    }

    try {
      const youtubeService = createYouTubeService()
      const youtubePlaylist = await youtubeService.getPlaylist(playlist.youtubeId, accessToken!)
      
      const updatedData = transformYouTubePlaylist(youtubePlaylist, userId)
      
      const updatedPlaylist = await prisma.youTubePlaylist.update({
        where: {
          id: playlistId,
        },
        data: {
          ...updatedData,
          lastSyncedAt: new Date(),
        },
      })

      return updatedPlaylist
    } catch (error) {
      console.error('Error updating playlist from YouTube:', error)
      throw new Error('Failed to update playlist from YouTube')
    }
  }
}

/**
 * Create YouTube playlist service instance
 */
export function createYouTubePlaylistService(): YouTubePlaylistService {
  return new YouTubePlaylistService()
}
