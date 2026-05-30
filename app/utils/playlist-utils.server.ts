import { prisma } from '#app/utils/db.server'
import type { YouTubeTokenData } from '#app/types/youtube'
import { ServiceNotFoundError, NoTokensError } from './service-playlist.server'

/**
 * Get service by name with error handling.
 * Pure utility — no YouTube-specific logic.
 *
 * @param serviceName - The name of the service to retrieve
 * @returns Promise resolving to the service record
 * @throws ServiceNotFoundError if service doesn't exist
 */
export async function getServiceByName(serviceName: string) {
  const service = await prisma.service.findUnique({
    where: { name: serviceName },
  })

  if (!service) {
    throw new ServiceNotFoundError(serviceName)
  }

  return service
}

/**
 * Get user connection for service with error handling.
 * Pure utility — no YouTube-specific logic.
 *
 * @param serviceName - The name of the service
 * @param userId - The user ID
 * @returns Promise resolving to the connection record
 * @throws NoTokensError if no connection or tokens found
 */
export async function getUserConnection(serviceName: string, userId: string) {
  const connection = await prisma.connection.findFirst({
    where: {
      providerName: serviceName,
      userId: userId,
    },
  })

  if (!connection || !connection.tokens) {
    throw new NoTokensError(serviceName)
  }

  return connection
}

/**
 * Parse and validate connection tokens.
 * Pure utility — no YouTube-specific logic (type parameter is generic).
 *
 * @param connection - Connection object with tokens field
 * @returns Parsed token data
 * @throws Error if tokens cannot be parsed
 */
export function parseConnectionTokens(connection: { tokens: string | null }): {
  access_token: string
} {
  if (!connection.tokens) {
    throw new Error('No tokens found in connection')
  }

  try {
    const tokenData = JSON.parse(connection.tokens) as YouTubeTokenData

    if (!tokenData.access_token) {
      throw new Error('No access token found in connection tokens')
    }

    return {
      access_token: tokenData.access_token,
    }
  } catch (error) {
    console.error('Error parsing connection tokens:', error)
    throw new Error('Failed to parse connection tokens')
  }
}
