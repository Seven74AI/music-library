
import { S3Client } from '@aws-sdk/client-s3'
import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock the AWS SDK before importing the module
vi.mock('@aws-sdk/client-s3', () => ({
	S3Client: vi.fn(),
	PutObjectCommand: vi.fn(),
}))

vi.mock('@aws-sdk/lib-storage', () => ({
	Upload: vi.fn(),
}))

// We need to re-import after mocking, but since the module already imported,
// we'll test the functions by calling them after setting up the mocks.
// The actual module import will have empty mocks, so we test the functions directly.

import {
	getS3Client,
	getBucketName,
	buildObjectKey,
} from './tigris-upload.server.ts'

describe('buildObjectKey', () => {
	it('builds a key from trackId and filename', () => {
		const key = buildObjectKey('track_abc123', 'my-video.mp3')
		expect(key).toBe('audio/track_abc123/my-video.mp3')
	})

	it('handles filenames with paths', () => {
		const key = buildObjectKey('track_xyz', '/tmp/downloads/song.mp3')
		// Should extract just the basename
		expect(key).toBe('audio/track_xyz/song.mp3')
	})

	it('handles filenames with special characters', () => {
		const key = buildObjectKey('track_001', 'Artist - Song (Official Video).mp3')
		expect(key).toBe('audio/track_001/Artist - Song (Official Video).mp3')
	})
})

describe('getBucketName', () => {
	const originalEnv = { ...process.env }

	beforeEach(() => {
		process.env = { ...originalEnv }
	})

	it('returns BUCKET_NAME from env', () => {
		process.env.BUCKET_NAME = 'my-audio-bucket'
		expect(getBucketName()).toBe('my-audio-bucket')
	})

	it('throws when BUCKET_NAME is not set', () => {
		delete process.env.BUCKET_NAME
		expect(() => getBucketName()).toThrow('BUCKET_NAME')
	})
})

describe('getS3Client', () => {
	const originalEnv = { ...process.env }

	beforeEach(() => {
		process.env = { ...originalEnv }
		vi.clearAllMocks()
	})

	it('creates an S3Client with Tigris configuration', () => {
		const client = getS3Client()
		expect(S3Client).toHaveBeenCalledWith(
			expect.objectContaining({
				region: expect.any(String),
				endpoint: expect.any(String),
				forcePathStyle: false,
			}),
		)
	})

	it('passes credentials from environment', () => {
		getS3Client()
		const callArgs = (S3Client as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
		expect(callArgs.credentials).toBeDefined()
		expect(callArgs.credentials.accessKeyId).toBeDefined()
		expect(callArgs.credentials.secretAccessKey).toBeDefined()
	})
})
