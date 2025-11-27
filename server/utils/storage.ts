import { type S3Client } from '@aws-sdk/client-s3'

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

// Storage configuration functions and singleton client are reserved for future use
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _getStorageConfig(): StorageConfig {
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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let _s3ClientInstance: S3Client | null = null


