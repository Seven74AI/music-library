export function formatPlayerTime(seconds: number) {
  if (isNaN(seconds) || !isFinite(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function isDurationKnown(duration: number): boolean {
  return duration > 0 && isFinite(duration) && !isNaN(duration);
}

/**
 * Generates a UUID v4 used to correlate a play's `play_started` and
 * `play_completed` usage events. Falls back to a Math.random-based UUID for
 * environments without Web Crypto `randomUUID` (older WebViews, non-secure
 * contexts).
 */
export function generatePlayId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function getPlaybackProgressPercent(currentTime: number, duration: number) {
  if (duration <= 0 || !isFinite(duration)) return 0;
  return Math.min(100, Math.max(0, (currentTime / duration) * 100));
}

export function getMediaErrorMessage(code: number): string {
  switch (code) {
    case 1: // MEDIA_ERR_ABORTED
      return "Playback was interrupted.";
    case 2: // MEDIA_ERR_NETWORK
      return "A network error prevented the audio from loading. Check your connection.";
    case 3: // MEDIA_ERR_DECODE
      return "This audio format is not supported by your browser.";
    case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
      return "The audio source could not be found or is not supported.";
    default:
      return "An unexpected playback error occurred. Please try again.";
  }
}

/**
 * Cache-bust a playback URL so the browser retries a failed load.
 * Used when the room speaker grant path is the same after a media error.
 */
export function withRecoveryNonce(url: string, now = Date.now()): string {
  const hashIndex = url.indexOf("#");
  const withoutHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : url.slice(hashIndex);
  const separator = withoutHash.includes("?") ? "&" : "?";
  return `${withoutHash}${separator}recovery=${now}${hash}`;
}

/** Swap <audio> to a new source URL, restore position, and optionally resume play. */
export function swapPlaybackSource(
  audio: HTMLAudioElement,
  nextUrl: string,
  savedTime: number,
  shouldResume: boolean,
) {
  const restore = () => {
    if (Number.isFinite(savedTime) && savedTime > 0) {
      audio.currentTime = savedTime;
    }
    if (shouldResume) {
      try {
        void Promise.resolve(audio.play()).catch(() => {
          // A newer load, or a terminal media error, supersedes this play().
        });
      } catch {
        // play() threw synchronously (for example, interrupted by a new load).
      }
    }
  };

  audio.src = nextUrl;
  // Attempt immediately (works for many blob swaps / jsdom); re-apply on loadeddata
  // in case the browser rejected the seek before media was ready.
  restore();
  if (audio.readyState < (HTMLMediaElement.HAVE_CURRENT_DATA ?? 2)) {
    audio.addEventListener("loadeddata", restore, { once: true });
  }
}

/** A new src/load aborted play(). Callers already surface the media error. */
export function isPlayInterrupted(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  return name === "AbortError" || message.includes("interrupted by a new load request");
}
