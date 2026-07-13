const COVER_IMAGE_PARAMS = 'fit=cover&format=webp'

/**
 * Build a proxied cover image URL at the requested square size.
 *
 * Returns an empty string when objectKey is null, undefined, or empty
 * so callers don't have to guard at every call site.
 */
export function coverImageUrl(objectKey: string | null | undefined, pixelSize: number): string {
	if (!objectKey) return ''
	return `/resources/images?src=${encodeURIComponent(objectKey)}&w=${pixelSize}&h=${pixelSize}&${COVER_IMAGE_PARAMS}`
}

/** 2x proxy sizes for track thumbnail display classes (xs–lg). */
export const trackThumbnailPixelSizes = {
	xs: 64,
	sm: 80,
	md: 96,
	lg: 112,
} as const

/** 2x proxy sizes for playlist cover display classes (sm–lg). */
export const playlistCoverPixelSizes = {
	sm: 128,
	md: 192,
	lg: 256,
} as const
