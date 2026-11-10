/**
 * Leaf module for safe Google API / Gaxios failure logging.
 * Must not import Prisma, DNS, storage, or other heavy server graphs.
 */

function getHttpStatusFromGoogleClientError(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;

  const response =
    "response" in error ? (error as { response?: { status?: number } }).response : undefined;
  if (response && typeof response.status === "number") {
    return response.status;
  }

  if ("status" in error && typeof (error as { status: unknown }).status === "number") {
    return (error as { status: number }).status;
  }

  return undefined;
}

function getErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error);
}

/** Strip API keys and OAuth secrets that may appear in Gaxios error strings. */
export function redactGoogleClientErrorMessage(message: string): string {
  return message
    .replace(/([?&])key=[^&\s"']+/gi, "$1key=[REDACTED]")
    .replace(/access_token[=:]['"]?[^\s&"']+/gi, "access_token=[REDACTED]")
    .replace(/refresh_token[=:]['"]?[^\s&"']+/gi, "refresh_token=[REDACTED]")
    .replace(/client_secret[=:]['"]?[^\s&"']+/gi, "client_secret=[REDACTED]")
    .replace(/(Authorization:\s*Bearer\s+)\S+/gi, "$1[REDACTED]")
    .replace(/(authorization['"]?\s*:\s*['"]Bearer\s+)[^'"]+/gi, "$1[REDACTED]");
}

function getSafeGoogleClientLogMessage(error: unknown): string {
  const raw = getErrorMessage(error);
  return redactGoogleClientErrorMessage(raw);
}

/** Safe string for Error `cause` — message (redacted) only; never a Gaxios object. */
export function googleClientErrorCauseMessage(error: unknown): string {
  return getSafeGoogleClientLogMessage(error);
}

function resolveDetailSource(error: unknown): unknown {
  if (error instanceof Error && error.cause !== undefined && error.cause !== null) {
    if (typeof error.cause === "string") return error.cause;
    if (typeof error.cause === "object") return error.cause;
  }
  return error;
}

/**
 * Logs a Google client failure with context, optional HTTP status, and a redacted message only.
 * Never logs the raw error object, `.cause`, `.config`, or response bodies.
 */
export function logGoogleApiError(context: string, error: unknown): void {
  const detailSource = resolveDetailSource(error);

  let message =
    getSafeGoogleClientLogMessage(detailSource) ||
    getSafeGoogleClientLogMessage(error) ||
    "Unknown error";

  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string" || typeof code === "number") {
      message = `${code}: ${message}`;
    }
  }

  const status =
    getHttpStatusFromGoogleClientError(detailSource) ?? getHttpStatusFromGoogleClientError(error);

  if (status !== undefined) {
    console.error(context, status, message);
  } else {
    console.error(context, message);
  }
}

/** @deprecated Import logGoogleApiError — thin alias for OAuth client sites. */
export const logGoogleOAuthClientError = logGoogleApiError;

/** @deprecated Import logGoogleApiError — thin alias for YouTube Data API client sites. */
export const logGoogleYouTubeDataApiClientError = logGoogleApiError;
