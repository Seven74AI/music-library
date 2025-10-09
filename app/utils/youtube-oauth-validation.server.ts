import { YOUTUBE_SERVICE } from '#app/constants/services'
import { type YouTubeTokenData, type ValidatedOAuthConnection } from '#app/types/youtube'
import { prisma } from '#app/utils/db.server'
import { shouldMockYouTube } from '#app/utils/youtube-mock-utils'
import { createYouTubeOAuthService } from '#app/utils/youtube-oauth.server'

/**
 * Validates YouTube OAuth connection and tokens
 * Attempts to refresh tokens if they are expired
 * 
 * @param userId - The user ID to check OAuth connection for
 * @returns Promise resolving to connection data if valid, null if invalid/expired and cannot refresh
 */
export async function validateYouTubeOAuth(userId: string): Promise<ValidatedOAuthConnection | null> {
  try {
    // Get YouTube connection (same logic for both mock and real scenarios)
    const connection = await prisma.connection.findFirst({
      where: {
        providerName: YOUTUBE_SERVICE.NAME,
        userId: userId,
      },
    })

    if (!connection || !connection.tokens) {
      return null
    }

    const tokenObj = JSON.parse(connection.tokens) as YouTubeTokenData

    // If mocking is enabled, skip all validation and return the connection
    if (shouldMockYouTube()) {
      return {
        connection,
        tokenData: tokenObj
      }
    }

    // Validate token format and check expiration
    try {
      
      if (!tokenObj.access_token) {
        return null
      }

      // Check if token is expired (if expiry_date exists)
      if (tokenObj.expiry_date && tokenObj.expiry_date < Date.now()) {
        console.log('YouTube OAuth token has expired, attempting refresh...')
        
        // Attempt to refresh the token
        if (tokenObj.refresh_token) {
          try {
            const oauthService = createYouTubeOAuthService()
            const refreshedTokens = await oauthService.refreshAccessToken(tokenObj.refresh_token)
            
            // Update the token data with refreshed tokens
            const updatedTokenData: YouTubeTokenData = {
              ...tokenObj,
              access_token: refreshedTokens.access_token,
              expiry_date: refreshedTokens.expiry_date,
            }
            
            // Update the database with refreshed tokens
            await prisma.connection.update({
              where: { id: connection.id },
              data: { tokens: JSON.stringify(updatedTokenData) }
            })
            
            console.log('YouTube OAuth token refreshed successfully')
            
            return {
              connection: { ...connection, tokens: JSON.stringify(updatedTokenData) },
              tokenData: updatedTokenData
            }
          } catch (refreshError) {
            console.error('Failed to refresh YouTube OAuth token:', refreshError)
            return null
          }
        } else {
          console.log('No refresh token available, user needs to re-authenticate')
          return null
        }
      }

      return {
        connection,
        tokenData: tokenObj
      }
    } catch (error) {
      console.error('Invalid YouTube OAuth token format:', error)
      return null
    }
  } catch (error) {
    console.error('Error validating YouTube OAuth:', error)
    return null
  }
}

/**
 * Refresh YouTube OAuth tokens for a user
 * 
 * @param userId - The user ID to refresh tokens for
 * @returns Promise resolving to updated token data if successful, null if failed
 */
export async function refreshYouTubeTokens(userId: string): Promise<YouTubeTokenData | null> {
  try {
    const connection = await prisma.connection.findFirst({
      where: {
        providerName: YOUTUBE_SERVICE.NAME,
        userId: userId,
      },
    })

    if (!connection || !connection.tokens) {
      return null
    }

    const tokenObj = JSON.parse(connection.tokens) as YouTubeTokenData
    
    if (!tokenObj.refresh_token) {
      console.log('No refresh token available for user')
      return null
    }

    const oauthService = createYouTubeOAuthService()
    const refreshedTokens = await oauthService.refreshAccessToken(tokenObj.refresh_token)
    
    const updatedTokenData: YouTubeTokenData = {
      ...tokenObj,
      access_token: refreshedTokens.access_token,
      expiry_date: refreshedTokens.expiry_date,
    }
    
    await prisma.connection.update({
      where: { id: connection.id },
      data: { tokens: JSON.stringify(updatedTokenData) }
    })
    
    return updatedTokenData
  } catch (error) {
    console.error('Error refreshing YouTube tokens:', error)
    return null
  }
}

/**
 * Disconnect YouTube OAuth connection for a user
 * 
 * @param userId - The user ID to disconnect
 * @returns Promise resolving to boolean indicating if disconnect was successful
 */
export async function disconnectYouTube(userId: string): Promise<boolean> {
  try {
    const result = await prisma.connection.deleteMany({
      where: {
        providerName: YOUTUBE_SERVICE.NAME,
        userId: userId,
      },
    })
    return result.count > 0
  } catch (error) {
    console.error('Error disconnecting YouTube:', error)
    return false
  }
}

/**
 * Check if user has valid YouTube OAuth connection
 * 
 * @param userId - The user ID to check
 * @returns Promise resolving to boolean indicating if user has valid OAuth
 */
export async function hasValidYouTubeOAuth(userId: string): Promise<boolean> {
  const validation = await validateYouTubeOAuth(userId)
  return validation !== null
}
