/**
 * Standardized YouTube error classes
 * Centralized error handling for YouTube-related operations
 */

// Base YouTube error class
export class YouTubeError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number
  ) {
    super(message)
    this.name = 'YouTubeError'
  }
}

// Specific YouTube error classes
export class YouTubeAPIError extends YouTubeError {
  constructor(message: string, code?: string, statusCode?: number) {
    super(message, code || 'API_ERROR', statusCode)
    this.name = 'YouTubeAPIError'
  }
}

export class YouTubeValidationError extends YouTubeError {
  constructor(message: string, _field?: string) {
    super(message, 'VALIDATION_ERROR')
    this.name = 'YouTubeValidationError'
  }
}

export class YouTubeNetworkError extends YouTubeError {
  constructor(message: string = 'Network error. Please check your connection and try again.') {
    super(message, 'NETWORK_ERROR', 503)
    this.name = 'YouTubeNetworkError'
  }
}

export class YouTubeQuotaError extends YouTubeError {
  constructor(message: string = 'YouTube API quota exceeded. Please try again later.') {
    super(message, 'QUOTA_EXCEEDED', 429)
    this.name = 'YouTubeQuotaError'
  }
}

export class YouTubeAuthError extends YouTubeError {
  constructor(message: string = 'Invalid YouTube API key') {
    super(message, 'INVALID_API_KEY', 401)
    this.name = 'YouTubeAuthError'
  }
}

export class YouTubeNotFoundError extends YouTubeError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 'NOT_FOUND', 404)
    this.name = 'YouTubeNotFoundError'
  }
}

// Service-specific error classes
export class ServiceNotFoundError extends YouTubeError {
  constructor(serviceName: string) {
    super(`Service ${serviceName} not found`, 'SERVICE_NOT_FOUND', 404)
    this.name = 'ServiceNotFoundError'
  }
}

export class PlaylistNotFoundError extends YouTubeError {
  constructor(playlistId: string) {
    super(`Playlist ${playlistId} not found`, 'PLAYLIST_NOT_FOUND', 404)
    this.name = 'PlaylistNotFoundError'
  }
}

export class NoTokensError extends YouTubeError {
  constructor(serviceName: string) {
    super(`No tokens found for service ${serviceName}`, 'NO_TOKENS', 401)
    this.name = 'NoTokensError'
  }
}

// Error code constants
export const YOUTUBE_ERROR_CODES = {
  API_ERROR: 'API_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  INVALID_API_KEY: 'INVALID_API_KEY',
  NOT_FOUND: 'NOT_FOUND',
  INVALID_QUERY: 'INVALID_QUERY',
  INVALID_VIDEO_ID: 'INVALID_VIDEO_ID',
  INVALID_MAX_RESULTS: 'INVALID_MAX_RESULTS',
  NO_API_KEY: 'NO_API_KEY',
  SEARCH_FAILED: 'SEARCH_FAILED',
  FETCH_FAILED: 'FETCH_FAILED',
} as const

// Error factory functions
export const YouTubeErrorFactory = {
  validation: (message: string, field?: string) => new YouTubeValidationError(message, field),
  network: (message?: string) => new YouTubeNetworkError(message),
  quota: (message?: string) => new YouTubeQuotaError(message),
  auth: (message?: string) => new YouTubeAuthError(message),
  notFound: (resource?: string) => new YouTubeNotFoundError(resource),
  api: (message: string, code?: string, statusCode?: number) => new YouTubeAPIError(message, code, statusCode),
} as const
