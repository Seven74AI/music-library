/**
 * Standardized YouTube error classes
 * Centralized error handling for YouTube-related operations
 *
 * This module provides a hierarchy of error classes for different types
 * of YouTube API and service-related errors with proper error codes and status codes.
 */

/**
 * Base YouTube error class
 * All YouTube-related errors extend this class
 */
export class YouTubeError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number,
  ) {
    super(message);
    this.name = "YouTubeError";
  }
}

/**
 * YouTube API error class
 * Used for general API-related errors
 */
export class YouTubeAPIError extends YouTubeError {
  constructor(message: string, code?: string, statusCode?: number) {
    super(message, code || "API_ERROR", statusCode);
    this.name = "YouTubeAPIError";
  }
}

/**
 * YouTube validation error class
 * Used for input validation errors
 */
export class YouTubeValidationError extends YouTubeError {
  constructor(message: string, _field?: string) {
    super(message, "VALIDATION_ERROR");
    this.name = "YouTubeValidationError";
  }
}

export class YouTubeNetworkError extends YouTubeError {
  constructor(message: string = "Network error. Please check your connection and try again.") {
    super(message, "NETWORK_ERROR", 503);
    this.name = "YouTubeNetworkError";
  }
}

export class YouTubeQuotaError extends YouTubeError {
  constructor(message: string = "YouTube API quota exceeded. Please try again later.") {
    super(message, "QUOTA_EXCEEDED", 429);
    this.name = "YouTubeQuotaError";
  }
}

export class YouTubeAuthError extends YouTubeError {
  constructor(message: string = "Invalid YouTube API key") {
    super(message, "INVALID_API_KEY", 401);
    this.name = "YouTubeAuthError";
  }
}

export class YouTubeNotFoundError extends YouTubeError {
  constructor(resource: string = "Resource") {
    super(`${resource} not found`, "NOT_FOUND", 404);
    this.name = "YouTubeNotFoundError";
  }
}

// Service-specific error classes
export class ServiceNotFoundError extends YouTubeError {
  constructor(serviceName: string) {
    super(`Service ${serviceName} not found`, "SERVICE_NOT_FOUND", 404);
    this.name = "ServiceNotFoundError";
  }
}

export class PlaylistNotFoundError extends YouTubeError {
  constructor(playlistId: string) {
    super(`Playlist ${playlistId} not found`, "PLAYLIST_NOT_FOUND", 404);
    this.name = "PlaylistNotFoundError";
  }
}

export class NoTokensError extends YouTubeError {
  constructor(serviceName: string) {
    super(`No tokens found for service ${serviceName}`, "NO_TOKENS", 401);
    this.name = "NoTokensError";
  }
}

// Error code constants
export const YOUTUBE_ERROR_CODES = {
  API_ERROR: "API_ERROR",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NETWORK_ERROR: "NETWORK_ERROR",
  QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
  INVALID_API_KEY: "INVALID_API_KEY",
  NOT_FOUND: "NOT_FOUND",
  INVALID_QUERY: "INVALID_QUERY",
  INVALID_VIDEO_ID: "INVALID_VIDEO_ID",
  INVALID_MAX_RESULTS: "INVALID_MAX_RESULTS",
  NO_API_KEY: "NO_API_KEY",
  SEARCH_FAILED: "SEARCH_FAILED",
  FETCH_FAILED: "FETCH_FAILED",
} as const;

export type YouTubeGoogleApiErrorPayload = {
  code?: number;
  message?: string;
  errors?: Array<{ message?: string; reason?: string }>;
};

export const YOUTUBE_PLAYLISTS_CLIENT_ERROR_MESSAGE =
  "Failed to fetch YouTube playlists. Please try again.";
export const YOUTUBE_PLAYLIST_ITEMS_CLIENT_ERROR_MESSAGE =
  "Failed to fetch playlist items. Please try again.";

/**
 * Map a Google YouTube API error payload to a domain error with a client-safe message.
 * Upstream `message` text is used only for classification (quota, access), never forwarded.
 */
export function throwFromYouTubeGoogleApiError(
  errorData: YouTubeGoogleApiErrorPayload,
  context: "playlists" | "playlistItems",
): never {
  const errorCode = errorData.code;
  const upstreamMessage = errorData.message ?? "";
  const firstError = errorData.errors?.[0];
  const genericMessage =
    context === "playlists"
      ? YOUTUBE_PLAYLISTS_CLIENT_ERROR_MESSAGE
      : YOUTUBE_PLAYLIST_ITEMS_CLIENT_ERROR_MESSAGE;
  const accessDeniedMessage =
    context === "playlistItems"
      ? "Access denied. The playlist may be private or you may not have permission to view it."
      : "Access denied. Please check your YouTube account permissions.";

  if (errorCode === 404) {
    throw new YouTubeNotFoundError("Playlist");
  }

  if (errorCode === 403) {
    if (upstreamMessage.includes("quota") || upstreamMessage.includes("Quota")) {
      throw new YouTubeQuotaError();
    }
    throw new YouTubeAPIError(accessDeniedMessage, "ACCESS_DENIED", 403);
  }

  if (errorCode === 401) {
    throw new YouTubeAuthError(
      "Invalid or expired access token. Please reconnect your YouTube account.",
    );
  }

  throw new YouTubeAPIError(genericMessage, YOUTUBE_ERROR_CODES.API_ERROR, errorCode || 500);
}

/**
 * Re-throw when the error is already a mapped YouTube domain error.
 */
export function rethrowIfYouTubeDomainError(error: unknown): void {
  if (
    error instanceof YouTubeAPIError ||
    error instanceof YouTubeNotFoundError ||
    error instanceof YouTubeQuotaError ||
    error instanceof YouTubeAuthError ||
    error instanceof YouTubeNetworkError
  ) {
    throw error;
  }
}

/**
 * Map transport-layer Error messages to domain errors without leaking upstream text.
 */
export function throwFromYouTubeTransportError(
  error: Error,
  context: "playlists" | "playlistItems",
): never {
  if (error.message.includes("quota")) {
    throw new YouTubeQuotaError();
  }
  if (
    error.message.includes("network") ||
    error.message.includes("timeout") ||
    error.message.includes("ECONNREFUSED")
  ) {
    throw new YouTubeNetworkError(
      "Unable to connect to YouTube. Please check your internet connection and try again.",
    );
  }
  if (context === "playlistItems") {
    if (error.message.includes("not found") || error.message.includes("404")) {
      throw new YouTubeNotFoundError("Playlist");
    }
  }
  const genericMessage =
    context === "playlists"
      ? YOUTUBE_PLAYLISTS_CLIENT_ERROR_MESSAGE
      : YOUTUBE_PLAYLIST_ITEMS_CLIENT_ERROR_MESSAGE;
  throw new YouTubeAPIError(genericMessage, YOUTUBE_ERROR_CODES.API_ERROR, 500);
}

// Error factory functions
export const YouTubeErrorFactory = {
  validation: (message: string, field?: string) => new YouTubeValidationError(message, field),
  network: (message?: string) => new YouTubeNetworkError(message),
  quota: (message?: string) => new YouTubeQuotaError(message),
  auth: (message?: string) => new YouTubeAuthError(message),
  notFound: (resource?: string) => new YouTubeNotFoundError(resource),
  api: (message: string, code?: string, statusCode?: number) =>
    new YouTubeAPIError(message, code, statusCode),
} as const;
