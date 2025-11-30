// @context7: @mjackson/form-data-parser, @paralleldrive/cuid2, AWS S3, Fetch API, TypeScript, crypto
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { type FileUpload } from '@mjackson/form-data-parser'
import { createId } from '@paralleldrive/cuid2'
import { type Timings } from '#app/utils/timing.server.ts'

// Constants
const DEFAULT_EXPIRY_SECONDS = 3600
const MAX_RETRY_ATTEMPTS = 3
const RETRY_MODE = 'adaptive' as const
const MAX_EXPIRY_SECONDS = 604800 // 7 days

/**
 * Check if storage is configured (all required env vars are set)
 */
function isStorageConfigured(): boolean {
  return !!(
    process.env.AWS_ENDPOINT_URL_S3 &&
    process.env.BUCKET_NAME &&
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_REGION
  )
}

// Environment configuration with validation
const getStorageConfig = (): {
  endpoint: string
  bucket: string
  accessKey: string
  secretKey: string
  region: string
} => {
  const config = {
    endpoint: process.env.AWS_ENDPOINT_URL_S3,
    bucket: process.env.BUCKET_NAME,
    accessKey: process.env.AWS_ACCESS_KEY_ID,
    secretKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION,
  }

  // Validate required environment variables
  const missingVars = Object.entries(config)
    .filter(([_, value]) => !value)
    .map(([key]) => key)

  if (missingVars.length > 0) {
    const errorMessage = `Missing required environment variables: ${missingVars.join(', ')}`
    console.error('Storage configuration error:', errorMessage)
    console.error('Current environment variables:', {
      AWS_ENDPOINT_URL_S3: process.env.AWS_ENDPOINT_URL_S3 ? 'SET' : 'MISSING',
      BUCKET_NAME: process.env.BUCKET_NAME ? 'SET' : 'MISSING',
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ? 'SET' : 'MISSING',
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ? 'SET' : 'MISSING',
      AWS_REGION: process.env.AWS_REGION ? 'SET' : 'MISSING',
      MOCKS: process.env.MOCKS,
      NODE_ENV: process.env.NODE_ENV,
    })
    throw new Error(errorMessage)
  }

  return {
    endpoint: config.endpoint as string,
    bucket: config.bucket as string,
    accessKey: config.accessKey as string,
    secretKey: config.secretKey as string,
    region: config.region as string,
  }
}

/**
 * Upload file to local filesystem (for development when storage is not configured)
 */
async function uploadFileLocal(file: Buffer, key: string): Promise<string> {
  const localStorageDir = join(process.cwd(), 'tests', 'fixtures', 'uploaded')
  const filePath = join(localStorageDir, key)
  const fileDir = dirname(filePath)
  
  // Create directory structure if it doesn't exist
  mkdirSync(fileDir, { recursive: true })
  
  // Write file to local filesystem
  writeFileSync(filePath, file)
  
  console.log(`📁 Saved file locally: ${filePath}`)
  return key
}

// Singleton S3 client for connection pooling
let s3ClientInstance: S3Client | null = null

/**
 * Get or create the singleton S3 client instance
 * @returns Configured S3Client instance
 */
export function getS3Client(): S3Client {
  if (!s3ClientInstance) {
    const config = getStorageConfig()
    
    s3ClientInstance = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      forcePathStyle: true, // Required for Tigris
      maxAttempts: MAX_RETRY_ATTEMPTS,
      retryMode: RETRY_MODE,
      requestChecksumCalculation: 'WHEN_REQUIRED', // Only calculate checksums when required
    })
  }
  
  return s3ClientInstance
}

/**
 * Unified signing function for GET and DELETE operations (presigned URLs)
 * @param params - Signing parameters
 * @returns Promise resolving to signed URL and headers
 */
export async function signRequest(params: {
  method: 'GET' | 'DELETE'
	key: string
  expirySeconds?: number
  timings?: Timings
}): Promise<{ url: string; headers: Record<string, string> }> {
  const { method, key, expirySeconds = DEFAULT_EXPIRY_SECONDS } = params
  
  // Validate input
  if (!key || typeof key !== 'string') {
    throw new Error('Invalid key: must be a non-empty string')
  }
  
  if (expirySeconds <= 0 || expirySeconds > MAX_EXPIRY_SECONDS) {
    throw new Error(`Invalid expirySeconds: must be between 1 and ${MAX_EXPIRY_SECONDS}`)
  }
  
  const s3Client = getS3Client()
  const config = getStorageConfig()
  
  let command: GetObjectCommand | DeleteObjectCommand
  
  switch (method) {
    case 'GET':
      command = new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
      })
      break
    case 'DELETE':
      command = new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: key,
      })
      break
    default:
      throw new Error(`Unsupported method: ${method}`)
  }
  
  try {
    const url = await getSignedUrl(s3Client, command, {
      expiresIn: expirySeconds,
	})

	return {
		url,
      headers: {}, // No headers needed for presigned URLs
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error(`Failed to generate signed URL for ${method} ${key}:`, error)
    throw new Error(`Failed to generate signed URL for ${method} ${key}: ${errorMessage}`)
  }
}

/**
 * Generic file upload function - Direct S3 client upload (more reliable)
 * @param params - Upload parameters
 * @returns Promise resolving to the uploaded object key
 */
export async function uploadFile(params: {
  file: File | FileUpload | Buffer
  key: string
  contentType?: string
  metadata?: Record<string, string>
  timings?: Timings
}): Promise<string> {
  const { file, key, contentType, metadata } = params
  
  // Validate input
  if (!file) {
    throw new Error('File is required')
  }
  
  if (!key || typeof key !== 'string') {
    throw new Error('Invalid key: must be a non-empty string')
  }
  
  // Use local file storage if storage is not configured (for local development)
  const useLocalStorage = !isStorageConfigured()
  if (useLocalStorage) {
    // Convert file to Buffer
    let fileBuffer: Buffer
    if (Buffer.isBuffer(file)) {
      fileBuffer = file
    } else if (file instanceof File) {
      const arrayBuffer = await file.arrayBuffer()
      fileBuffer = Buffer.from(arrayBuffer)
    } else {
      // FileUpload
      if ('buffer' in file && file.buffer instanceof ArrayBuffer) {
        fileBuffer = Buffer.from(file.buffer)
      } else if ('arrayBuffer' in file && typeof file.arrayBuffer === 'function') {
        const arrayBuffer = await file.arrayBuffer()
        fileBuffer = Buffer.from(arrayBuffer)
      } else {
        throw new Error('Unsupported file type for local storage')
      }
    }
    
    return uploadFileLocal(fileBuffer, key)
  }
  
  const s3Client = getS3Client()
  const config = getStorageConfig()
  
  let body: Uint8Array | ReadableStream
  if (file instanceof File) {
    // Convert File to ArrayBuffer, then to Uint8Array
    const arrayBuffer = await file.arrayBuffer()
    body = new Uint8Array(arrayBuffer)
  } else if ('stream' in file && typeof file.stream === 'function') {
    // For FileUpload, try to get the buffer directly if available
    if ('buffer' in file && file.buffer instanceof ArrayBuffer) {
      body = new Uint8Array(file.buffer)
    } else if ('arrayBuffer' in file && typeof file.arrayBuffer === 'function') {
      // Try to get the array buffer
      const arrayBuffer = await file.arrayBuffer()
      body = new Uint8Array(arrayBuffer)
    } else {
      // Fallback to stream conversion
      const stream = file.stream()
      const chunks: Uint8Array[] = []
      const reader = stream.getReader()
      
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
        }
      } finally {
        reader.releaseLock()
      }
      
      // Combine all chunks into a single Uint8Array
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
      const combined = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        combined.set(chunk, offset)
        offset += chunk.length
      }
      
      body = combined
    }
  } else if (Buffer.isBuffer(file)) {
    body = new Uint8Array(file)
  } else {
    throw new Error('Unsupported file type')
  }
  
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    Metadata: metadata,
  })
  
  try {
    await s3Client.send(command)
    return key
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error(`Failed to upload file to storage:`, {
      key,
      error: errorMessage,
      bucket: config.bucket,
      endpoint: config.endpoint,
      region: config.region,
      fileSize: body instanceof Uint8Array ? body.length : 'stream',
    })
    
    // Categorize S3/Tigris errors
    let errorType = 'STORAGE_ERROR'
    if (errorMessage.includes('AccessDenied') || errorMessage.includes('403')) {
      errorType = 'STORAGE_ACCESS_DENIED'
    } else if (errorMessage.includes('NoSuchBucket') || errorMessage.includes('404')) {
      errorType = 'STORAGE_BUCKET_NOT_FOUND'
    } else if (errorMessage.includes('timeout') || errorMessage.includes('ECONNRESET')) {
      errorType = 'STORAGE_NETWORK_ERROR'
    } else if (errorMessage.includes('InvalidAccessKeyId') || errorMessage.includes('SignatureDoesNotMatch')) {
      errorType = 'STORAGE_AUTH_ERROR'
    }
    
    throw new Error(`${errorType}: Failed to upload object: ${key} - ${errorMessage}`)
  }
}

/**
 * Generate signed URL for file access
 * @param key - Object key
 * @param expirySeconds - URL expiry time in seconds (default: 1 hour)
 * @param timings - Optional timing object for performance tracking
 * @returns Promise resolving to signed URL and headers
 */
export async function getFileUrl(
  key: string, 
  expirySeconds: number = DEFAULT_EXPIRY_SECONDS,
  timings?: Timings
): Promise<{ url: string; headers: Record<string, string> }> {
  // If storage is not configured, throw an error
  // The images route should check for local files first before calling this
  if (!isStorageConfigured()) {
    throw new Error('Storage is not configured. File should be served from local filesystem.')
  }
  
  return signRequest({
    method: 'GET',
    key,
    expirySeconds,
    timings,
  })
}

/**
 * Delete file from storage - Direct S3 client (more reliable)
 * @param key - Object key to delete
 * @param timings - Optional timing object for performance tracking
 * @returns Promise resolving when deletion is complete
 */
export async function deleteFile(
  key: string,
  _timings?: Timings
): Promise<void> {
  // Validate input
  if (!key || typeof key !== 'string') {
    throw new Error('Invalid key: must be a non-empty string')
  }
  
  const s3Client = getS3Client()
  const config = getStorageConfig()
  
  const command = new DeleteObjectCommand({
    Bucket: config.bucket,
    Key: key,
  })
  
  try {
    await s3Client.send(command)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error(`Failed to delete file from storage:`, error)
    throw new Error(`Failed to delete object: ${key} - ${errorMessage}`)
  }
}

/**
 * Upload profile image with standardized naming
 * @param userId - User ID
 * @param file - File to upload
 * @param timings - Optional timing object for performance tracking
 * @returns Promise resolving to the uploaded object key
 */
/**
 * Upload album art/cover image for a track
 * Uses cover management system with deduplication (hash + album grouping)
 * 
 * @deprecated Use findOrCreateCoverImage from cover-management.server.ts directly
 * This function is kept for backward compatibility but now uses the new system
 */
export async function uploadAlbumArt(
	params: {
		file: File | FileUpload | Buffer
		trackId: string
		albumId?: string | null
		timings?: Timings
	}
): Promise<string> {
	const { file, trackId, albumId } = params

	let imageBuffer: Buffer

	if (Buffer.isBuffer(file)) {
		imageBuffer = file
	} else if (file instanceof File) {
		const arrayBuffer = await file.arrayBuffer()
		imageBuffer = Buffer.from(arrayBuffer)
	} else {
		// FileUpload
		if ('buffer' in file && file.buffer instanceof ArrayBuffer) {
			imageBuffer = Buffer.from(file.buffer)
		} else if ('arrayBuffer' in file && typeof file.arrayBuffer === 'function') {
			const arrayBuffer = await file.arrayBuffer()
			imageBuffer = Buffer.from(arrayBuffer)
		} else {
			throw new Error('Unsupported file type for album art')
		}

	}

	// Use new cover management system
	const { findOrCreateCoverImage } = await import('./cover-management.server')
	const coverImage = await findOrCreateCoverImage({
		imageBuffer,
		albumId,
		trackId,
	})

	return coverImage.objectKey
}

export async function uploadProfileImage(
  userId: string,
  file: File | FileUpload,
  timings?: Timings
): Promise<string> {
  // Validate input
  if (!userId || typeof userId !== 'string') {
    throw new Error('Invalid userId: must be a non-empty string')
  }
  
  if (!file) {
    throw new Error('File is required')
  }
  
  const fileId = createId()
  const fileExtension = file.name.split('.').pop() || 'jpg'
  const timestamp = Date.now()
  const key = `images/profile-images/${userId}/${timestamp}-${fileId}.${fileExtension}`
  
  return uploadFile({
    file,
    key,
    contentType: file.type || 'image/jpeg',
    timings,
  })
}
