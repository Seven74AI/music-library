const RECOVERABLE_CATEGORIES = new Set(['COOKIE_EXPIRED', 'FORMAT_UNAVAILABLE'])

function hasRecoverableMessage(message: string): boolean {
	const lower = message.toLowerCase()
	return (
		lower.includes('format is not available') ||
		lower.includes('only images are available') ||
		lower.includes('sign in to confirm') ||
		lower.includes('cookies are no longer valid')
	)
}

/**
 * Whether a failed archive job should be retried after fixing cookies or yt-dlp format selection.
 * Excludes permanent failures like geo-blocked or removed videos.
 */
export function isRecoverableArchiveFailure(errorHistoryJson: string): boolean {
	try {
		const errors = JSON.parse(errorHistoryJson) as unknown
		if (!Array.isArray(errors) || errors.length === 0) return false

		const latest = errors[errors.length - 1] as { category?: string; message?: string }
		const category = latest.category ?? ''
		const message = latest.message ?? ''

		if (RECOVERABLE_CATEGORIES.has(category)) return true
		return hasRecoverableMessage(message)
	} catch {
		return false
	}
}
