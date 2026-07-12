/**
 * Preferred Audio Format priority (CONTEXT.md):
 * FLAC → WAV → MP3 → M4A → OGG → AAC → WebM → first available
 */
const FORMAT_PRIORITY = ['flac', 'wav', 'mp3', 'm4a', 'ogg', 'aac', 'webm'] as const

type AudioFileWithFormat = { format: string | null }

export function selectBestAudioFile<T extends AudioFileWithFormat>(
	audioFiles: T[],
): T | null {
	if (audioFiles.length === 0) {
		return null
	}

	for (const format of FORMAT_PRIORITY) {
		const file = audioFiles.find((f) => f.format === format)
		if (file) {
			return file
		}
	}

	return audioFiles[0] ?? null
}
