import { S3Client, PutObjectCommand, S3ServiceException } from '@aws-sdk/client-s3'

/**
 * Storage configuration type for S3-compatible storage
 * Contains all required configuration for connecting to storage service
 */
type StorageConfig = {
  endpoint: string
  bucket: string
  accessKey: string
  secretKey: string
  region: string
}

/**
 * Validate and get storage configuration from environment variables
 * @returns Validated storage configuration object
 * @throws {Error} If required environment variables are missing
 */
function getStorageConfig(): StorageConfig {
  const config = {
    endpoint: process.env.AWS_ENDPOINT_URL_S3,
    bucket: process.env.BUCKET_NAME,
    accessKey: process.env.AWS_ACCESS_KEY_ID,
    secretKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION,
  }

  const missingVars = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key)

  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`)
  }

  return config as StorageConfig
}

// Singleton S3 client for connection pooling
let s3ClientInstance: S3Client | null = null

/**
 * Get or create S3 client instance
 * Uses singleton pattern for connection pooling
 * @returns S3Client instance configured for the storage service
 */
function getS3Client(): S3Client {
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
      maxAttempts: 3,
      retryMode: 'adaptive' as const,
    })
  }
  return s3ClientInstance
}

/**
 * Upload audio file buffer to S3 storage
 * Simplified version for worker use - only handles Buffers
 * @param buffer - Audio file buffer to upload
 * @param objectKey - S3 object key (path) for the file
 * @param metadata - Metadata to attach to the uploaded file
 * @returns Promise resolving to the object key of the uploaded file
 * @throws {Error} If upload fails or inputs are invalid
 */
export async function uploadAudioFile(
  buffer: Buffer,
  objectKey: string,
  metadata: Record<string, string>
): Promise<string> {
  // Validate inputs
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('Buffer is required')
  }
  if (!objectKey || typeof objectKey !== 'string') {
    throw new Error('Invalid objectKey')
  }
  if (!metadata || typeof metadata !== 'object') {
    throw new Error('Metadata is required')
  }

  const config = getStorageConfig()
  const client = getS3Client()
  
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: objectKey,
    Body: buffer,
    ContentType: 'audio/mpeg',
    Metadata: metadata,
  })

  try {
    await client.send(command)
    return objectKey
  } catch (caught) {
    if (
      caught instanceof S3ServiceException &&
      caught.name === 'EntityTooLarge'
    ) {
      console.error(
        `Error from S3 while uploading object to ${config.bucket}. ` +
        `The object was too large. To upload objects larger than 5GB, use the S3 console (160GB max) ` +
        `or the multipart upload API (5TB max).`
      )
      throw new Error(`Audio file too large: ${objectKey}`)
    } else if (caught instanceof S3ServiceException) {
      console.error(
        `Error from S3 while uploading object to ${config.bucket}. ${caught.name}: ${caught.message}`
      )
      throw new Error(`S3 upload failed for ${objectKey}: ${caught.message}`)
    } else {
      console.error(`Failed to upload audio file ${objectKey}:`, caught)
      throw caught
    }
  }
}
