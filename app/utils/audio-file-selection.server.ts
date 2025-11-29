// @context7: Prisma, TypeScript
import { type Prisma } from '#prisma/client.js'

type TrackAudioFile = Prisma.TrackAudioFileGetPayload<{}>

/**
 * Format priority for audio file selection
 * Higher priority formats are preferred
 */
const FORMAT_PRIORITY = ['flac', 'wav', 'mp3', 'm4a', 'ogg', 'aac', 'webm'] as const

/**
 * Get the best available audio file for a track
 * Priority: FLAC > WAV > MP3 > M4A > OGG > AAC > WebM > others
 * 
 * @param audioFiles - Array of audio files for the track
 * @returns Best audio file or null if none available
 */
export function getBestAudioFile(
	audioFiles: TrackAudioFile[]
): TrackAudioFile | null {
	if (audioFiles.length === 0) {
		return null
	}

	// Try to find file in priority order
	for (const format of FORMAT_PRIORITY) {
		const file = audioFiles.find((f) => f.format === format)
		if (file) {
			return file
		}
	}

	// Fallback to first available file
	return audioFiles[0] || null
}

/**
 * Get audio file by specific format
 * 
 * @param audioFiles - Array of audio files for the track
 * @param format - Desired format (e.g., 'mp3', 'flac')
 * @returns Audio file with specified format or null
 */
export function getAudioFileByFormat(
	audioFiles: TrackAudioFile[],
	format: string
): TrackAudioFile | null {
	return audioFiles.find((f) => f.format === format) || null
}

/**
 * Get all available formats for a track
 * 
 * @param audioFiles - Array of audio files for the track
 * @returns Array of available format strings
 */
export function getAvailableFormats(audioFiles: TrackAudioFile[]): string[] {
	return audioFiles
		.map((f) => f.format)
		.filter((f): f is string => f !== null && f !== undefined)
}




