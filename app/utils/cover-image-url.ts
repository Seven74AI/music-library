const COVER_IMAGE_PARAMS = "fit=cover&format=webp";

/**
 * Build a proxied cover image URL at the requested square size.
 *
 * Returns an empty string when objectKey is null, undefined, or empty
 * so callers don't have to guard at every call site.
 */
export function coverImageUrl(objectKey: string | null | undefined, pixelSize: number): string {
  if (!objectKey) return "";
  return `/resources/images?src=${encodeURIComponent(objectKey)}&w=${pixelSize}&h=${pixelSize}&${COVER_IMAGE_PARAMS}`;
}

/** 2x proxy sizes for track thumbnail display classes (xs–lg). */
export const trackThumbnailPixelSizes = {
  xs: 64,
  sm: 80,
  md: 96,
  lg: 112,
} as const;

/** 2x proxy sizes for playlist cover display classes (sm–lg). */
export const playlistCoverPixelSizes = {
  sm: 128,
  md: 192,
  lg: 256,
} as const;

/**
 * Retina size for the mobile now-playing sheet cover (h-40 / 160px CSS → 320px).
 * Kept as a shared constant so the player can warm this URL while the mini bar
 * is visible — the sheet remounts on each open and would otherwise refetch.
 */
export const nowPlayingCoverPixelSize = 320;

/**
 * Retina size for MusicEntityHeader covers (h-48 / 192px CSS → 384px).
 */
export const entityHeaderCoverPixelSize = 384;

/**
 * Album cards are fluid squares in a 2–5 column grid inside a 1400px container.
 * The widest card image is about 230px, so 512px stays sharp at 2×.
 */
export const albumCardCoverPixelSize = 512;
