// @context7: music-metadata, File, Buffer, TypeScript
import { parseBuffer, type IAudioMetadata } from 'music-metadata'

export interface ExtractedAudioMetadata {
	title?: string
	artist?: string
	album?: string
	albumArtist?: string
	genre?: string[]
	composer?: string
	year?: number
	date?: string // YYYY-MM-DD format
	track?: { no: number; of?: number }
	disk?: { no: number; of?: number }
	duration?: number // in seconds
	bitrate?: number // in kbps
	sampleRate?: number // in Hz
	format?: string // "mp3", "flac", "wav", etc.
	mimeType?: string
	lossless?: boolean
	numberOfChannels?: number
	bitsPerSample?: number
	// Additional metadata fields
	bpm?: number
	label?: string
	isrc?: string
	originalDate?: string // YYYY-MM-DD format
	originalYear?: number
	releaseDate?: string // YYYY-MM-DD format
	totalTracks?: number
	totalDiscs?: number
	lyrics?: string
	// Cover image extracted from audio file metadata
	coverImage?: { data: Buffer; format: string }
}

/**
 * Extract metadata from an audio file buffer
 * 
 * @param buffer - Audio file buffer
 * @param fileName - Optional file name for format detection
 * @returns Promise resolving to extracted metadata
 */
export async function extractAudioMetadata(
	buffer: Buffer,
	fileName?: string
): Promise<ExtractedAudioMetadata> {
	try {
		const metadata: IAudioMetadata = await parseBuffer(buffer)

		// Extract format from metadata or file extension
		const format = getFormatFromMetadata(metadata, fileName)
		const mimeType = getMimeTypeFromFormat(format)

		// Helper function to extract string from string or array
		const extractString = (value: string | string[] | undefined): string | undefined => {
			if (!value) return undefined
			if (Array.isArray(value)) {
				return value.length > 0 ? value[0] : undefined
			}
			return value
		}

		// Helper function to extract array from string or array
		const extractArray = (value: string | string[] | undefined): string[] | undefined => {
			if (!value) return undefined
			if (Array.isArray(value)) {
				return value.length > 0 ? value : undefined
			}
			return [value]
		}

		// Extract common tags
		const title = extractString(metadata.common.title)
		// Artist: prefer artist, fallback to artists array (first element)
		const artist = extractString(metadata.common.artist) || 
			(Array.isArray(metadata.common.artists) && metadata.common.artists.length > 0
				? metadata.common.artists[0]
				: undefined)
		const album = extractString(metadata.common.album)
		const albumArtist = extractString(metadata.common.albumartist)
		const genre = extractArray(metadata.common.genre)
		const composer = extractString(metadata.common.composer)

		// Extract date/year
		const date = extractString(metadata.common.date) // YYYY-MM-DD format
		const year = metadata.common.year
			? (typeof metadata.common.year === 'number' ? metadata.common.year : parseInt(String(metadata.common.year), 10))
			: undefined

		// Extract track and disk numbers
		// Handle null values in track/disk objects
		const track = metadata.common.track && metadata.common.track.no !== null
			? {
					no: metadata.common.track.no,
					...(metadata.common.track.of !== null && metadata.common.track.of !== undefined
						? { of: metadata.common.track.of }
						: {}),
				}
			: undefined
		const disk = metadata.common.disk && metadata.common.disk.no !== null
			? {
					no: metadata.common.disk.no,
					...(metadata.common.disk.of !== null && metadata.common.disk.of !== undefined
						? { of: metadata.common.disk.of }
						: {}),
				}
			: undefined

		// Extract additional metadata fields
		const bpm = metadata.common.bpm
		const label = extractString(metadata.common.label)
		const isrc = extractString(metadata.common.isrc)
		const originalDate = extractString(metadata.common.originaldate)
		const originalYear = metadata.common.originalyear
			? (typeof metadata.common.originalyear === 'number' 
				? metadata.common.originalyear 
				: parseInt(String(metadata.common.originalyear), 10))
			: undefined
		const releaseDate = extractString(metadata.common.releasedate)
		
		// Extract totalTracks from track.of or totaltracks field
		const totalTracksRaw = track?.of || metadata.common.totaltracks
		const totalTracks = typeof totalTracksRaw === 'number' ? totalTracksRaw : undefined
		
		// Extract totalDiscs from disk.of or totaldiscs field
		const totalDiscsRaw = disk?.of || metadata.common.totaldiscs
		const totalDiscs = typeof totalDiscsRaw === 'number' ? totalDiscsRaw : undefined
		
		// Extract lyrics (take first element if array, or combine if multiple)
		// lyrics can be ILyricsTag[] which has text property
		let lyrics: string | undefined
		const lyricsData = metadata.common.lyrics
		if (Array.isArray(lyricsData)) {
			lyrics = lyricsData
				.map(item => typeof item === 'string' ? item : (item as any)?.text || '')
				.filter(Boolean)
				.join('\n')
		} else if (typeof lyricsData === 'string') {
			lyrics = lyricsData
		}

		// Extract cover image from pictures array
		// Prefer pictures with description "cover" or "front cover", otherwise use the first one
		let coverImage: { data: Buffer; format: string } | undefined
		if (metadata.common.picture && metadata.common.picture.length > 0) {
			// Try to find a picture with cover-related description
			const coverPicture = metadata.common.picture.find(
				pic => pic.description?.toLowerCase().includes('cover') ||
					pic.description?.toLowerCase().includes('front')
			) || metadata.common.picture[0]

			if (coverPicture && coverPicture.data) {
				// Convert Uint8Array to Buffer if needed
				const imageData = Buffer.isBuffer(coverPicture.data)
					? coverPicture.data
					: Buffer.from(coverPicture.data)
				coverImage = {
					data: imageData,
					format: coverPicture.format || 'image/jpeg',
				}
			}
		}

		// Extract audio format properties
		const duration = metadata.format.duration
			? Math.round(metadata.format.duration)
			: undefined
		const bitrate = metadata.format.bitrate
			? Math.round(metadata.format.bitrate / 1000) // Convert to kbps
			: undefined
		const sampleRate = metadata.format.sampleRate
			? Math.round(metadata.format.sampleRate)
			: undefined
		const lossless = metadata.format.lossless
		const numberOfChannels = metadata.format.numberOfChannels
		const bitsPerSample = metadata.format.bitsPerSample

		return {
			title: title || undefined,
			artist: artist || undefined,
			album: album || undefined,
			albumArtist: albumArtist || undefined,
			genre: genre || undefined,
			composer: composer || undefined,
			year: year || undefined,
			date: date || undefined,
			track: track || undefined,
			disk: disk || undefined,
			duration,
			bitrate,
			sampleRate,
			format,
			mimeType,
			lossless,
			numberOfChannels,
			bitsPerSample,
			bpm: bpm || undefined,
			label: label || undefined,
			isrc: isrc || undefined,
			originalDate: originalDate || undefined,
			originalYear: originalYear || undefined,
			releaseDate: releaseDate || undefined,
			totalTracks: totalTracks || undefined,
			totalDiscs: totalDiscs || undefined,
			lyrics: lyrics || undefined,
			coverImage: coverImage || undefined,
		}
	} catch (error) {
		console.error('Error extracting audio metadata:', error)
		// Fallback to format detection from filename
		const format = getFormatFromFileName(fileName)
		return {
			format,
			mimeType: getMimeTypeFromFormat(format),
		}
	}
}

/**
 * Get audio format from metadata or filename
 */
function getFormatFromMetadata(
	metadata: IAudioMetadata,
	fileName?: string
): string | undefined {
	// Try to get format from metadata first
	if (metadata.format.container) {
		const container = metadata.format.container.toLowerCase()
		// Map common containers to formats
		if (container.includes('mp3') || container.includes('mpeg')) {
			return 'mp3'
		}
		if (container.includes('flac')) {
			return 'flac'
		}
		if (container.includes('wav') || container.includes('wave')) {
			return 'wav'
		}
		if (container.includes('m4a') || container.includes('mp4')) {
			return 'm4a'
		}
		if (container.includes('ogg')) {
			return 'ogg'
		}
		if (container.includes('aac')) {
			return 'aac'
		}
	}

	// Fallback to filename extension
	return getFormatFromFileName(fileName)
}

/**
 * Get format from file extension
 */
function getFormatFromFileName(fileName?: string): string | undefined {
	if (!fileName) return undefined

	const extension = fileName.split('.').pop()?.toLowerCase()
	if (!extension) return undefined

	// Map extensions to formats
	const formatMap: Record<string, string> = {
		mp3: 'mp3',
		flac: 'flac',
		wav: 'wav',
		m4a: 'm4a',
		aac: 'aac',
		ogg: 'ogg',
		opus: 'ogg',
		webm: 'webm',
	}

	return formatMap[extension]
}

/**
 * Get MIME type from format
 */
function getMimeTypeFromFormat(format?: string): string | undefined {
	if (!format) return undefined

	const mimeTypeMap: Record<string, string> = {
		mp3: 'audio/mpeg',
		flac: 'audio/flac',
		wav: 'audio/wav',
		m4a: 'audio/mp4',
		aac: 'audio/aac',
		ogg: 'audio/ogg',
		webm: 'audio/webm',
	}

	return mimeTypeMap[format]
}

