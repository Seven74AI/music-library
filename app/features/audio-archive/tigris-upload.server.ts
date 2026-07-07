import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'

/**
 * Get the S3/Tigris bucket name from environment.
 * Throws if BUCKET_NAME is not configured.
 */
export function getBucketName(): string {
	const bucket = process.env.BUCKET_NAME
	if (!bucket) {
		throw new Error('BUCKET_NAME environment variable is not set')
	}
	return bucket
}

/**
 * Build the S3 object key for an uploaded audio file.
 * Format: audio/{trackId}/{filename}
 */
export function buildObjectKey(trackId: string, filePath: string): string {
	const filename = path.basename(filePath)
	return `audio/${trackId}/${filename}`
}

/**
 * Get a configured S3Client for Tigris Object Storage.
 * Tigris requires forcePathStyle: true and a custom endpoint.
 */
export function getS3Client(): S3Client {
	return new S3Client({
		region: process.env.AWS_REGION ?? 'auto',
		endpoint: process.env.AWS_ENDPOINT_URL_S3 ?? 'https://fly.storage.tigris.dev',
		credentials: {
			accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
			secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
		},
		forcePathStyle: true, // Required for Tigris
	})
}

export interface UploadResult {
	key: string
	bucket: string
	location: string
}

/**
 * Upload a file to Tigris Object Storage.
 *
 * Uses @aws-sdk/lib-storage Upload for multipart upload support,
 * which handles large files efficiently.
 *
 * In MOCKS mode (MOCKS=true env), returns a simulated result without
 * actually uploading — useful for CI and development.
 *
 * @param filePath - Local path to the file to upload
 * @param key - S3 object key (path within the bucket)
 * @returns UploadResult with key, bucket, and object URL
 */
export async function uploadToTigris(
	filePath: string,
	key: string,
): Promise<UploadResult> {
	if (process.env.MOCKS === 'true') {
		const bucket = getBucketName()
		return {
			key,
			bucket,
			location: `https://${bucket}.fly.storage.tigris.dev/${key}`,
		}
	}

	const bucket = getBucketName()
	const client = getS3Client()

	// Use @aws-sdk/lib-storage Upload for multipart support
	const fileStream = createReadStream(filePath)
	const fileSize = (await stat(filePath)).size

	const upload = new Upload({
		client,
		params: {
			Bucket: bucket,
			Key: key,
			Body: fileStream,
			ContentType: 'audio/mpeg',
		},
		// Use multipart for files > 5MB
		partSize: fileSize > 5 * 1024 * 1024 ? 5 * 1024 * 1024 : undefined,
	})

	await upload.done()

	return {
		key,
		bucket,
		location: `https://${bucket}.fly.storage.tigris.dev/${key}`,
	}
}

/**
 * Upload a file to Tigris using a simple PutObjectCommand.
 * Suitable for smaller files (< 5MB). For larger files, use uploadToTigris.
 */
export async function uploadFileSimple(
	filePath: string,
	key: string,
): Promise<UploadResult> {
	if (process.env.MOCKS === 'true') {
		const bucket = getBucketName()
		return {
			key,
			bucket,
			location: `https://${bucket}.fly.storage.tigris.dev/${key}`,
		}
	}

	const bucket = getBucketName()
	const client = getS3Client()

	const fileStream = createReadStream(filePath)

	const command = new PutObjectCommand({
		Bucket: bucket,
		Key: key,
		Body: fileStream,
		ContentType: 'audio/mpeg',
	})

	await client.send(command)

	return {
		key,
		bucket,
		location: `https://${bucket}.fly.storage.tigris.dev/${key}`,
	}
}

/**
 * Get a presigned URL for an object in Tigris.
 * URLs expire after the specified duration (default: 1 hour).
 */
export async function getPresignedUrl(
	key: string,
	expiresInSeconds: number = 3600,
): Promise<string> {
	if (process.env.MOCKS === 'true') {
		const bucket = getBucketName()
		return `https://${bucket}.fly.storage.tigris.dev/${key}?presigned=true&expires=${expiresInSeconds}`
	}

	const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')
	const { GetObjectCommand } = await import('@aws-sdk/client-s3')

	const bucket = getBucketName()
	const client = getS3Client()

	const command = new GetObjectCommand({
		Bucket: bucket,
		Key: key,
	})

	return getSignedUrl(client, command, { expiresIn: expiresInSeconds })
}
