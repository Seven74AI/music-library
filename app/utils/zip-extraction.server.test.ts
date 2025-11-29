import { describe, expect, test, vi, beforeEach } from 'vitest'
import { extractAudioFilesFromZip } from './zip-extraction.server'

// Mock adm-zip
vi.mock('adm-zip', () => {
	return {
		default: vi.fn().mockImplementation((_buffer: Buffer) => {
			const mockZip = {
				getEntries: vi.fn(),
			}
			return mockZip
		}),
	}
})

describe('extractAudioFilesFromZip', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	test('extracts audio files from ZIP and filters out non-audio files', async () => {
		const AdmZip = (await import('adm-zip')).default
		
		const mockZipInstance = {
			getEntries: vi.fn(() => [
				{
					entryName: 'song1.mp3',
					getData: vi.fn().mockReturnValue(Buffer.from('fake mp3 data')),
					isDirectory: false,
				},
				{
					entryName: 'song2.flac',
					getData: vi.fn().mockReturnValue(Buffer.from('fake flac data')),
					isDirectory: false,
				},
				{
					entryName: 'readme.txt',
					getData: vi.fn().mockReturnValue(Buffer.from('readme content')),
					isDirectory: false,
				},
				{
					entryName: 'folder/',
					getData: vi.fn(),
					isDirectory: true,
				},
			]),
		}

		vi.mocked(AdmZip).mockImplementation(() => mockZipInstance as any)

		const zipBuffer = Buffer.from('fake zip data')
		const result = await extractAudioFilesFromZip(zipBuffer)

		expect(result).toHaveLength(2)
		expect(result[0]).toEqual({
			fileName: 'song1.mp3',
			buffer: Buffer.from('fake mp3 data'),
		})
		expect(result[1]).toEqual({
			fileName: 'song2.flac',
			buffer: Buffer.from('fake flac data'),
		})
	})

	test('handles nested directory structures', async () => {
		const AdmZip = (await import('adm-zip')).default
		
		const mockZipInstance = {
			getEntries: vi.fn(() => [
				{
					entryName: 'album1/track1.mp3',
					getData: vi.fn().mockReturnValue(Buffer.from('track1 data')),
					isDirectory: false,
				},
				{
					entryName: 'album1/track2.wav',
					getData: vi.fn().mockReturnValue(Buffer.from('track2 data')),
					isDirectory: false,
				},
				{
					entryName: 'album2/track3.m4a',
					getData: vi.fn().mockReturnValue(Buffer.from('track3 data')),
					isDirectory: false,
				},
			]),
		}

		vi.mocked(AdmZip).mockImplementation(() => mockZipInstance as any)

		const zipBuffer = Buffer.from('fake zip data')
		const result = await extractAudioFilesFromZip(zipBuffer)

		expect(result).toHaveLength(3)
		expect(result[0]?.fileName).toBe('album1/track1.mp3')
		expect(result[1]?.fileName).toBe('album1/track2.wav')
		expect(result[2]?.fileName).toBe('album2/track3.m4a')
	})

	test('returns empty array for ZIP with no audio files', async () => {
		const AdmZip = (await import('adm-zip')).default
		
		const mockZipInstance = {
			getEntries: vi.fn(() => [
				{
					entryName: 'readme.txt',
					getData: vi.fn().mockReturnValue(Buffer.from('readme')),
					isDirectory: false,
				},
				{
					entryName: 'image.jpg',
					getData: vi.fn().mockReturnValue(Buffer.from('image data')),
					isDirectory: false,
				},
			]),
		}

		vi.mocked(AdmZip).mockImplementation(() => mockZipInstance as any)

		const zipBuffer = Buffer.from('fake zip data')
		const result = await extractAudioFilesFromZip(zipBuffer)

		expect(result).toHaveLength(0)
	})

	test('handles empty ZIP file', async () => {
		const AdmZip = (await import('adm-zip')).default
		
		const mockZipInstance = {
			getEntries: vi.fn(() => []),
		}

		vi.mocked(AdmZip).mockImplementation(() => mockZipInstance as any)

		const zipBuffer = Buffer.from('fake zip data')
		const result = await extractAudioFilesFromZip(zipBuffer)

		expect(result).toHaveLength(0)
	})

	test('supports various audio formats', async () => {
		const AdmZip = (await import('adm-zip')).default
		
		const mockZipInstance = {
			getEntries: vi.fn(() => [
				{
					entryName: 'track1.mp3',
					getData: vi.fn().mockReturnValue(Buffer.from('mp3')),
					isDirectory: false,
				},
				{
					entryName: 'track2.flac',
					getData: vi.fn().mockReturnValue(Buffer.from('flac')),
					isDirectory: false,
				},
				{
					entryName: 'track3.wav',
					getData: vi.fn().mockReturnValue(Buffer.from('wav')),
					isDirectory: false,
				},
				{
					entryName: 'track4.m4a',
					getData: vi.fn().mockReturnValue(Buffer.from('m4a')),
					isDirectory: false,
				},
				{
					entryName: 'track5.aac',
					getData: vi.fn().mockReturnValue(Buffer.from('aac')),
					isDirectory: false,
				},
				{
					entryName: 'track6.ogg',
					getData: vi.fn().mockReturnValue(Buffer.from('ogg')),
					isDirectory: false,
				},
			]),
		}

		vi.mocked(AdmZip).mockImplementation(() => mockZipInstance as any)

		const zipBuffer = Buffer.from('fake zip data')
		const result = await extractAudioFilesFromZip(zipBuffer)

		expect(result).toHaveLength(6)
		expect(result.map(r => r.fileName)).toEqual([
			'track1.mp3',
			'track2.flac',
			'track3.wav',
			'track4.m4a',
			'track5.aac',
			'track6.ogg',
		])
	})

	test('handles case-insensitive file extensions', async () => {
		const AdmZip = (await import('adm-zip')).default
		
		const mockZipInstance = {
			getEntries: vi.fn(() => [
				{
					entryName: 'TRACK1.MP3',
					getData: vi.fn().mockReturnValue(Buffer.from('mp3')),
					isDirectory: false,
				},
				{
					entryName: 'track2.FLAC',
					getData: vi.fn().mockReturnValue(Buffer.from('flac')),
					isDirectory: false,
				},
			]),
		}

		vi.mocked(AdmZip).mockImplementation(() => mockZipInstance as any)

		const zipBuffer = Buffer.from('fake zip data')
		const result = await extractAudioFilesFromZip(zipBuffer)

		expect(result).toHaveLength(2)
	})

	test('throws error for invalid ZIP file', async () => {
		const AdmZip = (await import('adm-zip')).default
		
		vi.mocked(AdmZip).mockImplementation(() => {
			throw new Error('Invalid ZIP file')
		})

		const zipBuffer = Buffer.from('invalid zip data')
		
		await expect(extractAudioFilesFromZip(zipBuffer)).rejects.toThrow('Invalid ZIP file')
	})
})

