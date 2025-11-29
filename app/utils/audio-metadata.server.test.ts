import  { type IAudioMetadata } from 'music-metadata'
import { describe, expect, test, vi, beforeEach } from 'vitest'
import { extractAudioMetadata } from './audio-metadata.server'

// Mock music-metadata
vi.mock('music-metadata', () => ({
	parseBuffer: vi.fn(),
}))

describe('extractAudioMetadata', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	test('extracts basic metadata fields', async () => {
		const { parseBuffer } = await import('music-metadata')
		
		const mockMetadata = {
			format: {
				container: 'mp3',
				duration: 180.5,
				bitrate: 320000,
				sampleRate: 44100,
				lossless: false,
				numberOfChannels: 2,
				bitsPerSample: 16,
			},
			common: {
				title: 'Test Song',
				artist: 'Test Artist',
				album: 'Test Album',
				albumartist: 'Test Album Artist',
				genre: ['Rock'],
				composer: 'Test Composer',
				year: 2023,
				date: '2023-01-15',
				track: { no: 1, of: 12 },
				disk: { no: 1, of: 2 },
			},
			native: {},
			quality: { warnings: [] },
		} as unknown as IAudioMetadata

		vi.mocked(parseBuffer).mockResolvedValue(mockMetadata)

		const buffer = Buffer.from('fake audio data')
		const result = await extractAudioMetadata(buffer, 'test.mp3')

		expect(result.title).toBe('Test Song')
		expect(result.artist).toBe('Test Artist')
		expect(result.album).toBe('Test Album')
		expect(result.albumArtist).toBe('Test Album Artist')
		expect(result.genre).toEqual(['Rock'])
		expect(result.composer).toBe('Test Composer')
		expect(result.year).toBe(2023)
		expect(result.date).toBe('2023-01-15')
		expect(result.track).toEqual({ no: 1, of: 12 })
		expect(result.disk).toEqual({ no: 1, of: 2 })
		expect(result.duration).toBe(181) // rounded
		expect(result.bitrate).toBe(320) // converted to kbps
		expect(result.sampleRate).toBe(44100)
		expect(result.format).toBe('mp3')
		expect(result.mimeType).toBe('audio/mpeg')
		expect(result.lossless).toBe(false)
		expect(result.numberOfChannels).toBe(2)
		expect(result.bitsPerSample).toBe(16)
	})

	test('extracts BPM field', async () => {
		const { parseBuffer } = await import('music-metadata')
		
		const mockMetadata = {
			format: { container: 'mp3' },
			common: {
				title: 'Test Song',
				artist: 'Test Artist',
				bpm: 128,
			},
			native: {},
			quality: { warnings: [] },
		} as unknown as IAudioMetadata

		vi.mocked(parseBuffer).mockResolvedValue(mockMetadata)

		const buffer = Buffer.from('fake audio data')
		const result = await extractAudioMetadata(buffer)

		expect(result.bpm).toBe(128)
	})

	test('extracts label field', async () => {
		const { parseBuffer } = await import('music-metadata')
		
		const mockMetadata = {
			format: { container: 'mp3' },
			common: {
				title: 'Test Song',
				artist: 'Test Artist',
				label: ['Test Label'],
			},
			native: {},
			quality: { warnings: [] },
		} as unknown as IAudioMetadata

		vi.mocked(parseBuffer).mockResolvedValue(mockMetadata)

		const buffer = Buffer.from('fake audio data')
		const result = await extractAudioMetadata(buffer)

		expect(result.label).toBe('Test Label')
	})

	test('extracts ISRC field', async () => {
		const { parseBuffer } = await import('music-metadata')
		
		const mockMetadata = {
			format: { container: 'mp3' },
			common: {
				title: 'Test Song',
				artist: 'Test Artist',
				isrc: ['USRC17607839'],
			},
			native: {},
			quality: { warnings: [] },
		} as unknown as IAudioMetadata

		vi.mocked(parseBuffer).mockResolvedValue(mockMetadata)

		const buffer = Buffer.from('fake audio data')
		const result = await extractAudioMetadata(buffer)

		expect(result.isrc).toBe('USRC17607839')
	})

	test('extracts originalDate and originalYear fields', async () => {
		const { parseBuffer } = await import('music-metadata')
		
		const mockMetadata = {
			format: { container: 'mp3' },
			common: {
				title: 'Test Song',
				artist: 'Test Artist',
				originaldate: '2020-06-15',
				originalyear: 2020,
			},
			native: {},
			quality: { warnings: [] },
		} as unknown as IAudioMetadata

		vi.mocked(parseBuffer).mockResolvedValue(mockMetadata)

		const buffer = Buffer.from('fake audio data')
		const result = await extractAudioMetadata(buffer)

		expect(result.originalDate).toBe('2020-06-15')
		expect(result.originalYear).toBe(2020)
	})

	test('extracts releaseDate field', async () => {
		const { parseBuffer } = await import('music-metadata')
		
		const mockMetadata = {
			format: { container: 'mp3' },
			common: {
				title: 'Test Song',
				artist: 'Test Artist',
				releasedate: '2023-01-15',
			},
			native: {},
			quality: { warnings: [] },
		} as unknown as IAudioMetadata

		vi.mocked(parseBuffer).mockResolvedValue(mockMetadata)

		const buffer = Buffer.from('fake audio data')
		const result = await extractAudioMetadata(buffer)

		expect(result.releaseDate).toBe('2023-01-15')
	})

	test('extracts totalTracks from track.of', async () => {
		const { parseBuffer } = await import('music-metadata')
		
		const mockMetadata = {
			format: { container: 'mp3' },
			common: {
				title: 'Test Song',
				artist: 'Test Artist',
				track: { no: 5, of: 12 },
			},
			native: {},
			quality: { warnings: [] },
		} as unknown as IAudioMetadata

		vi.mocked(parseBuffer).mockResolvedValue(mockMetadata)

		const buffer = Buffer.from('fake audio data')
		const result = await extractAudioMetadata(buffer)

		expect(result.totalTracks).toBe(12)
	})

	test('extracts totalTracks from totaltracks field', async () => {
		const { parseBuffer } = await import('music-metadata')
		
		const mockMetadata = {
			format: { container: 'mp3' },
			common: {
				title: 'Test Song',
				artist: 'Test Artist',
				totaltracks: 15,
			},
			native: {},
			quality: { warnings: [] },
		} as unknown as IAudioMetadata

		vi.mocked(parseBuffer).mockResolvedValue(mockMetadata)

		const buffer = Buffer.from('fake audio data')
		const result = await extractAudioMetadata(buffer)

		expect(result.totalTracks).toBe(15)
	})

	test('extracts totalDiscs from disk.of', async () => {
		const { parseBuffer } = await import('music-metadata')
		
		const mockMetadata = {
			format: { container: 'mp3' },
			common: {
				title: 'Test Song',
				artist: 'Test Artist',
				disk: { no: 1, of: 2 },
			},
			native: {},
			quality: { warnings: [] },
		} as unknown as IAudioMetadata

		vi.mocked(parseBuffer).mockResolvedValue(mockMetadata)

		const buffer = Buffer.from('fake audio data')
		const result = await extractAudioMetadata(buffer)

		expect(result.totalDiscs).toBe(2)
	})

	test('extracts totalDiscs from totaldiscs field', async () => {
		const { parseBuffer } = await import('music-metadata')
		
		const mockMetadata = {
			format: { container: 'mp3' },
			common: {
				title: 'Test Song',
				artist: 'Test Artist',
				totaldiscs: 3,
			},
			native: {},
			quality: { warnings: [] },
		} as unknown as IAudioMetadata

		vi.mocked(parseBuffer).mockResolvedValue(mockMetadata)

		const buffer = Buffer.from('fake audio data')
		const result = await extractAudioMetadata(buffer)

		expect(result.totalDiscs).toBe(3)
	})

	test('extracts lyrics field', async () => {
		const { parseBuffer } = await import('music-metadata')
		
		const mockMetadata = {
			format: { container: 'mp3' },
			common: {
				title: 'Test Song',
				artist: 'Test Artist',
				lyrics: ['First line of lyrics', 'Second line of lyrics'],
			},
			native: {},
			quality: { warnings: [] },
		} as unknown as IAudioMetadata

		vi.mocked(parseBuffer).mockResolvedValue(mockMetadata)

		const buffer = Buffer.from('fake audio data')
		const result = await extractAudioMetadata(buffer)

		expect(result.lyrics).toBe('First line of lyrics\nSecond line of lyrics')
	})

	test('combines multiple lyrics into single string', async () => {
		const { parseBuffer } = await import('music-metadata')
		
		const mockMetadata = {
			format: { container: 'mp3' },
			common: {
				title: 'Test Song',
				artist: 'Test Artist',
				lyrics: ['Verse 1', 'Verse 2', 'Chorus'],
			},
			native: {},
			quality: { warnings: [] },
		} as unknown as IAudioMetadata

		vi.mocked(parseBuffer).mockResolvedValue(mockMetadata)

		const buffer = Buffer.from('fake audio data')
		const result = await extractAudioMetadata(buffer)

		// Lyrics are combined with newlines when multiple entries exist
		expect(result.lyrics).toBe('Verse 1\nVerse 2\nChorus')
	})

	test('handles missing optional fields gracefully', async () => {
		const { parseBuffer } = await import('music-metadata')
		
		const mockMetadata = {
			format: { container: 'mp3' },
			common: {
				title: 'Test Song',
				artist: 'Test Artist',
			},
			native: {},
			quality: { warnings: [] },
		} as unknown as IAudioMetadata

		vi.mocked(parseBuffer).mockResolvedValue(mockMetadata)

		const buffer = Buffer.from('fake audio data')
		const result = await extractAudioMetadata(buffer)

		expect(result.bpm).toBeUndefined()
		expect(result.label).toBeUndefined()
		expect(result.isrc).toBeUndefined()
		expect(result.originalDate).toBeUndefined()
		expect(result.originalYear).toBeUndefined()
		expect(result.releaseDate).toBeUndefined()
		expect(result.totalTracks).toBeUndefined()
		expect(result.totalDiscs).toBeUndefined()
		expect(result.lyrics).toBeUndefined()
	})

	test('handles array values for single-value fields', async () => {
		const { parseBuffer } = await import('music-metadata')
		
		const mockMetadata = {
			format: { container: 'mp3' },
			common: {
				title: 'Test Song',
				artist: 'Test Artist',
				label: ['Label 1', 'Label 2'],
				isrc: ['ISRC1', 'ISRC2'],
			},
			native: {},
			quality: { warnings: [] },
		} as unknown as IAudioMetadata

		vi.mocked(parseBuffer).mockResolvedValue(mockMetadata)

		const buffer = Buffer.from('fake audio data')
		const result = await extractAudioMetadata(buffer)

		// Should take first element
		expect(result.label).toBe('Label 1')
		expect(result.isrc).toBe('ISRC1')
	})

	test('handles errors gracefully and returns format from filename', async () => {
		const { parseBuffer } = await import('music-metadata')
		const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		
		vi.mocked(parseBuffer).mockRejectedValue(new Error('Parse error'))

		const buffer = Buffer.from('invalid audio data')
		const result = await extractAudioMetadata(buffer, 'test.flac')

		expect(result.format).toBe('flac')
		expect(result.mimeType).toBe('audio/flac')
		expect(result.title).toBeUndefined()
		expect(result.artist).toBeUndefined()
		
		consoleErrorSpy.mockRestore()
	})

	test('extracts all new metadata fields together', async () => {
		const { parseBuffer } = await import('music-metadata')
		
		const mockMetadata: IAudioMetadata = {
			format: {
				container: 'flac',
				duration: 240.3,
				bitrate: 1411000,
				sampleRate: 44100,
				lossless: true,
			},
			common: {
				title: 'Complete Test Song',
				artist: 'Complete Test Artist',
				album: 'Complete Test Album',
				albumartist: 'Complete Album Artist',
				genre: ['Electronic', 'House'],
				bpm: 128,
				label: ['Test Records'],
				isrc: ['USRC17607839'],
				originaldate: '2020-06-15',
				originalyear: 2020,
				releasedate: '2023-01-15',
				track: { no: 5, of: 12 },
				disk: { no: 1, of: 2 },
				lyrics: ['These are the lyrics', 'More lyrics here'],
			},
			native: {},
			quality: { warnings: [] },
		} as unknown as IAudioMetadata

		vi.mocked(parseBuffer).mockResolvedValue(mockMetadata)

		const buffer = Buffer.from('fake audio data')
		const result = await extractAudioMetadata(buffer, 'test.flac')

		expect(result.bpm).toBe(128)
		expect(result.label).toBe('Test Records')
		expect(result.isrc).toBe('USRC17607839')
		expect(result.originalDate).toBe('2020-06-15')
		expect(result.originalYear).toBe(2020)
		expect(result.releaseDate).toBe('2023-01-15')
		expect(result.totalTracks).toBe(12)
		expect(result.totalDiscs).toBe(2)
		expect(result.lyrics).toBe('These are the lyrics\nMore lyrics here')
	})
})

