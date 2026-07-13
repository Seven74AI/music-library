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
		const file = audioFiles.find((f) => f.format?.toLowerCase() === format)
		if (file) {
			return file
		}
	}

	// Fallback: no audio file matched any format in FORMAT_PRIORITY — return the
	// first available file. This relies on audioFiles being in a stable order.
	// Currently, Prisma queries that include audioFiles (see app/utils/home.server.ts
	// and app/features/queue/queue-playback.server.ts) do not specify an explicit
	// orderBy, so files are returned in database natural order (typically insertion
	// order / primary key). If format-priority sorting is needed for the fallback,
	// those queries should add a custom order (e.g., by a format rank or index).
	return audioFiles[0] ?? null
}
