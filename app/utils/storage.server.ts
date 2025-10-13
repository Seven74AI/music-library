// @context7: @mjackson/form-data-parser, @paralleldrive/cuid2, AWS S3, Fetch API, TypeScript, crypto
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { type FileUpload } from '@mjackson/form-data-parser'
import { createId } from '@paralleldrive/cuid2'
import { type Timings } from '#app/utils/timing.server.ts'

// Constants
const DEFAULT_EXPIRY_SECONDS = 3600
const MAX_RETRY_ATTEMPTS = 3
const RETRY_MODE = 'adaptive' as const
const MAX_EXPIRY_SECONDS = 604800 // 7 days

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
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`)
  }

  return {
    endpoint: config.endpoint as string,
    bucket: config.bucket as string,
    accessKey: config.accessKey as string,
    secretKey: config.secretKey as string,
    region: config.region as string,
  }
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
    console.error(`Failed to upload file to storage:`, error)
    throw new Error(`Failed to upload object: ${key} - ${errorMessage}`)
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
