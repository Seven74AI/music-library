/**
 * Service-related constants
 * Centralized location for all service names and identifiers
 */

/**
 * YouTube service constants
 */
export const YOUTUBE_SERVICE = {
  NAME: 'youtube' as const,
  PROVIDER_ID: 'youtube' as const,
  DISPLAY_NAME: 'YouTube',
  BASE_URL: 'https://youtube.com',
} as const

/**
 * All supported services
 */
export const SERVICES = {
  YOUTUBE: YOUTUBE_SERVICE,
} as const

/**
 * Service names as union type for type safety
 */
export type ServiceName = typeof SERVICES[keyof typeof SERVICES]['NAME']
