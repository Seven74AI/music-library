import { type FullTrack } from '#app/types/frontend/shared'
import { coverImageUrl } from '#app/utils/cover-image-url.ts'

export function buildMediaSessionMetadata(track: FullTrack) {
	return {
		title: track.title,
		artist: track.artist.name,
		album: '',
		artwork: track.coverImage
			? [
					{
						src: coverImageUrl(track.coverImage.objectKey, 512),
						sizes: '512x512',
						type: 'image/webp',
					},
				]
			: [],
	}
}

export function isMediaSessionSupported(): boolean {
	return typeof navigator !== 'undefined' && 'mediaSession' in navigator
}
