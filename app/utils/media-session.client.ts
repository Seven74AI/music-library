import { type FullTrack } from '#app/types/frontend/shared'
import { coverImageUrl } from '#app/utils/cover-image-url.ts'

/** Sizes recommended for MediaMetadata artwork (iOS lock screen through Android). */
const MEDIA_SESSION_ARTWORK_SIZES = [96, 128, 192, 256, 384, 512] as const

export function buildMediaSessionArtwork(objectKey: string) {
	return MEDIA_SESSION_ARTWORK_SIZES.map((size) => ({
		src: coverImageUrl(objectKey, size),
		sizes: `${size}x${size}`,
		type: 'image/webp',
	}))
}

export function buildMediaSessionMetadata(track: FullTrack) {
	return {
		title: track.title,
		artist: track.artist.name,
		album: 'Unknown Album',
		artwork: track.coverImage
			? buildMediaSessionArtwork(track.coverImage.objectKey)
			: [],
	}
}

export function isMediaSessionSupported(): boolean {
	return typeof navigator !== 'undefined' && 'mediaSession' in navigator
}

export function isMediaSessionPositionStateSupported(): boolean {
	return (
		isMediaSessionSupported() && 'setPositionState' in navigator.mediaSession
	)
}

type MediaSessionTiming = Pick<
	HTMLAudioElement,
	'currentTime' | 'duration' | 'playbackRate'
>

export function clampMediaSessionSeekTime(
	seekTime: number,
	duration: number,
): number {
	return Math.min(Math.max(0, seekTime), duration)
}

export function updateMediaSessionPositionState(audio: MediaSessionTiming): void {
	if (!isMediaSessionPositionStateSupported()) return

	const { duration, currentTime, playbackRate } = audio
	if (!duration || !isFinite(duration) || duration <= 0) return
	if (!isFinite(currentTime) || currentTime < 0) return
	if (!playbackRate || playbackRate <= 0) return

	try {
		navigator.mediaSession.setPositionState({
			duration,
			position: clampMediaSessionSeekTime(currentTime, duration),
			playbackRate,
		})
	} catch {
		// setPositionState throws when state is invalid
	}
}

export function clearMediaSessionPositionState(): void {
	if (!isMediaSessionPositionStateSupported()) return

	try {
		navigator.mediaSession.setPositionState()
	} catch {
		// ignore unsupported clear
	}
}
