#!/usr/bin/env tsx
/**
 * Script to reset/clear all files from Tigris storage
 * 
 * Usage:
 *   npm run reset-storage
 *   or
 *   tsx scripts/reset-storage.ts
 */

import 'dotenv/config'
import { ListObjectsV2Command, DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3'

// Get storage configuration from environment
function getStorageConfig() {
  const config = {
    endpoint: process.env.AWS_ENDPOINT_URL_S3,
    bucket: process.env.BUCKET_NAME,
    accessKey: process.env.AWS_ACCESS_KEY_ID,
    secretKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION,
  }

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

async function resetStorage() {
  const config = getStorageConfig()
  
  const s3Client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    },
    forcePathStyle: true, // Required for Tigris
  })

  console.log('🗑️  Starting storage reset...')
  console.log(`📦 Bucket: ${config.bucket}`)
  console.log(`🌐 Endpoint: ${config.endpoint}`)
  console.log('')

  let totalDeleted = 0
  let continuationToken: string | undefined

  try {
    // List and delete all objects in batches
    do {
      // List objects
      const listCommand = new ListObjectsV2Command({
        Bucket: config.bucket,
        ContinuationToken: continuationToken,
      })

      const listResponse = await s3Client.send(listCommand)
      const objects = listResponse.Contents || []

      if (objects.length === 0) {
        if (totalDeleted === 0) {
          console.log('✅ Storage is already empty!')
        }
        break
      }

      // Delete objects in batch (max 1000 per request)
      const deleteCommand = new DeleteObjectsCommand({
        Bucket: config.bucket,
        Delete: {
          Objects: objects.map(obj => ({ Key: obj.Key! })),
          Quiet: false,
        },
      })

      const deleteResponse = await s3Client.send(deleteCommand)
      const deleted = deleteResponse.Deleted || []
      const errors = deleteResponse.Errors || []

      totalDeleted += deleted.length

      if (errors.length > 0) {
        console.error('❌ Errors deleting some objects:')
        errors.forEach(error => {
          console.error(`   - ${error.Key}: ${error.Message}`)
        })
      }

      console.log(`   Deleted ${deleted.length} objects (total: ${totalDeleted})`)

      continuationToken = listResponse.NextContinuationToken
    } while (continuationToken)

    console.log('')
    console.log(`✅ Successfully deleted ${totalDeleted} objects from storage!`)
  } catch (error) {
    console.error('❌ Error resetting storage:', error)
    process.exit(1)
  }
}

// Run the script
resetStorage().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})

