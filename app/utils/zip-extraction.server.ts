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

			const fileName = entry.entryName

			// Skip macOS metadata files FIRST (before any other checks)
			// - Files in __MACOSX/ directory
			// - Files whose filename (basename) starts with ._ (macOS resource fork files)
			// Note: We check the basename only, not the full path, to avoid filtering
			// legitimate files that might have underscores in their titles
			const basename = fileName.split('/').pop() || fileName
			if (fileName.includes('__MACOSX/') || basename.startsWith('._')) {
				continue
			}

			// Check if file has a valid audio extension (only process files from our allowed list)
			if (!isAudioFile(fileName)) {
				continue
			}

			// Extract file data (getData returns Buffer directly)
			const buffer = entry.getData()
			const fileBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)

			// Skip files that are too small (likely corrupted or metadata files)
			// Audio files should be at least a few KB
			if (fileBuffer.length < 1024) {
				continue
			}

			audioFiles.push({
				fileName,
				buffer: fileBuffer,
			})
		}

		return audioFiles
	} catch (error) {
		throw new Error(
			`Failed to extract audio files from ZIP: ${error instanceof Error ? error.message : 'Unknown error'}`
		)
	}
}

