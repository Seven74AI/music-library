/**
 * Reusable Error Handlers
 *
 * This file provides reusable error handling utilities to reduce code duplication
 * across route loaders and actions.
 */

import { data } from "react-router";
import { ServiceNotFoundError as PlaylistServiceNotFoundError } from "#app/features/service-playlist/playlist-utils.server";
import { ValidationError } from "#app/utils/validation.ts";
import { YouTubeError } from "#app/utils/youtube-errors.ts";
import { ZipExtractionLimitError } from "#app/utils/zip-extraction.server.ts";

export const DEFAULT_CLIENT_ERROR_MESSAGE = "Something went wrong. Please try again.";

export const UPLOAD_AUDIO_CLIENT_ERROR_MESSAGE = "Failed to upload audio file.";
export const UPLOAD_BATCH_FILE_CLIENT_ERROR_MESSAGE = "Failed to upload file.";
export const UPLOAD_BATCH_ZIP_CLIENT_ERROR_MESSAGE = "Failed to extract ZIP file.";
export const UPLOAD_BATCH_METADATA_EXTRACT_CLIENT_ERROR_MESSAGE = "Failed to read audio metadata.";
export const SERVICE_IMPORT_CLIENT_ERROR_MESSAGE = "Unable to import this track. Please try again.";
export const SERVICE_PLAYLIST_SYNC_CLIENT_ERROR_MESSAGE =
  "Failed to sync playlist. Please try again.";

function isKnownClientError(error: unknown): error is Error {
  return (
    error instanceof YouTubeError ||
    error instanceof ValidationError ||
    error instanceof PlaylistServiceNotFoundError ||
    error instanceof ZipExtractionLimitError
  );
}

/**
 * Map an unknown thrown value to a message safe to return to the browser.
 * Raw Error.message (including Prisma/DB text) is never forwarded unless the
 * error is a known domain error type.
 */
export function toClientErrorMessage(
  error: unknown,
  fallback: string = DEFAULT_CLIENT_ERROR_MESSAGE,
): string {
  if (isKnownClientError(error)) {
    return error.message;
  }
  return fallback;
}

/**
 * Standard error handler for route loaders
 */
export function handleLoaderError<T>(
  error: unknown,
  fallback: T,
  context?: string,
): ReturnType<typeof data<T>> {
  const contextMsg = context ? `Error loading ${context}:` : "Error in loader:";
  console.error(contextMsg, error);

  return data(fallback);
}

/**
 * Standard error handler for service operations
 */
export function handleServiceError(
  error: unknown,
  operation: string,
  service: string = "Service",
  clientFallback: string = DEFAULT_CLIENT_ERROR_MESSAGE,
): { success: false; error: string } {
  console.error(`${service} ${operation} error:`, error);

  return {
    success: false,
    error: toClientErrorMessage(error, clientFallback),
  };
}
