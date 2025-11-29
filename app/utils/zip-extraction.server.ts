// @context7: adm-zip, Buffer, TypeScript
import AdmZip from 'adm-zip'

export interface ExtractedAudioFile {
	fileName: string
	buffer: Buffer
}

/**
 * Supported audio file extensions
 */
const AUDIO_EXTENSIONS = new Set([
	'mp3',
	'flac',
	'wav',
	'm4a',
	'aac',
	'ogg',
	'opus',
	'webm',
])

/**
 * Check if a file extension is an audio format
 */
function isAudioFile(fileName: string): boolean {
	const extension = fileName.split('.').pop()?.toLowerCase()
	return extension ? AUDIO_EXTENSIONS.has(extension) : false
}

/**
 * Extract all audio files from a ZIP archive
 * 
 * @param zipBuffer - ZIP file buffer
 * @returns Promise resolving to array of extracted audio files with their original filenames
 */
export async function extractAudioFilesFromZip(
	zipBuffer: Buffer
): Promise<ExtractedAudioFile[]> {
	try {
		const zip = new AdmZip(zipBuffer)
		const entries = zip.getEntries()

		const audioFiles: ExtractedAudioFile[] = []

		for (const entry of entries) {
			// Skip directories
			if (entry.isDirectory) {
				continue
			}

			// Check if file is an audio file
			if (!isAudioFile(entry.entryName)) {
				continue
			}

			// Extract file data (getData returns Buffer directly)
			const buffer = entry.getData()

			audioFiles.push({
				fileName: entry.entryName,
				buffer: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
			})
		}

		return audioFiles
	} catch (error) {
		throw new Error(
			`Failed to extract audio files from ZIP: ${error instanceof Error ? error.message : 'Unknown error'}`
		)
	}
}

