import { YOUTUBE_SERVICE } from '#app/constants/services'
import { type YouTubeTokenData, type ValidatedOAuthConnection } from '#app/types/youtube'
import { prisma } from '#app/utils/db.server'

/**
 * Validates YouTube OAuth connection and tokens
 * 
 * @param userId - The user ID to check OAuth connection for
 * @returns Promise resolving to connection data if valid, null if invalid/expired
 */
export async function validateYouTubeOAuth(userId: string): Promise<ValidatedOAuthConnection | null> {
  try {
    // Get YouTube connection
    const connection = await prisma.connection.findFirst({
      where: {
        providerName: YOUTUBE_SERVICE.NAME,
        userId: userId,
      },
    })

    if (!connection || !connection.tokens) {
      return null
    }

    // Validate token format and check expiration
    try {
      const tokenObj = JSON.parse(connection.tokens) as YouTubeTokenData
      
      if (!tokenObj.access_token) {
        return null
      }

      // Check if token is expired (if expiry_date exists)
      if (tokenObj.expiry_date && tokenObj.expiry_date < Date.now()) {
        console.log('YouTube OAuth token has expired')
        return null
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
 * Check if user has valid YouTube OAuth connection
 * 
 * @param userId - The user ID to check
 * @returns Promise resolving to boolean indicating if user has valid OAuth
 */
export async function hasValidYouTubeOAuth(userId: string): Promise<boolean> {
  const validation = await validateYouTubeOAuth(userId)
  return validation !== null
}
