#!/usr/bin/env tsx
/**
 * One-time migration: unify TrackAudioFile object keys to
 * audio/tracks/{serviceName}/{trackId}.{ext}
 *
 * Operator runbook:
 * 1. Pause the archive worker (admin UI or set WorkerState to paused)
 * 2. Deploy code that writes unified keys for new uploads/archives
 * 3. Run: npm run migrate-audio-keys
 * 4. Verify a sample of migrated tracks play correctly
 * 5. Resume the archive worker
 *
 * Idempotent: rows already on unified keys are skipped; re-runs copy only when needed.
 *
 * Usage:
 *   tsx scripts/migrate-audio-object-keys.ts
 *   tsx scripts/migrate-audio-object-keys.ts --dry-run
 */

import 'dotenv/config'
import {
	CopyObjectCommand,
	DeleteObjectCommand,
	HeadObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { getDatabaseUrl } from '#app/utils/database-url.server.ts'
import {
	buildAudioObjectKey,
	isUnifiedAudioObjectKey,
} from '#app/utils/storage.server'
import { PrismaClient } from '#prisma/client.js'

const dryRun = process.argv.includes('--dry-run')

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

function extractExtension(objectKey: string): string {
	const basename = objectKey.split('/').pop() ?? objectKey
	const dot = basename.lastIndexOf('.')
	if (dot === -1) {
		throw new Error(`Cannot determine extension from object key: ${objectKey}`)
	}
	return basename.slice(dot + 1)
}

function createS3Client(config: ReturnType<typeof getStorageConfig>): S3Client {
	return new S3Client({
		region: config.region,
		endpoint: config.endpoint,
		credentials: {
			accessKeyId: config.accessKey,
			secretAccessKey: config.secretKey,
		},
		forcePathStyle: false,
	})
}

async function objectExists(
	s3: S3Client,
	bucket: string,
	key: string,
): Promise<boolean> {
	try {
		await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
		return true
	} catch (error) {
		if (
			error &&
			typeof error === 'object' &&
			'name' in error &&
			(error as { name?: string }).name === 'NotFound'
		) {
			return false
		}
		const message = error instanceof Error ? error.message : String(error)
		if (message.includes('404') || message.includes('Not Found')) {
			return false
		}
		throw error
	}
}

async function migrateAudioObjectKeys() {
	const config = getStorageConfig()
	const s3 = createS3Client(config)
	const adapter = new PrismaBetterSqlite3({ url: getDatabaseUrl() })
	const prisma = new PrismaClient({ adapter })

	console.log(dryRun ? '🔍 Dry run — no writes' : '🚀 Migrating audio object keys')
	console.log(`📦 Bucket: ${config.bucket}`)
	console.log('')

	const audioFiles = await prisma.trackAudioFile.findMany({
		select: {
			id: true,
			trackId: true,
			objectKey: true,
			track: {
				select: {
					service: { select: { name: true } },
				},
			},
		},
	})

	let skipped = 0
	let migrated = 0
	let errors = 0

	for (const audioFile of audioFiles) {
		const { objectKey, trackId, id } = audioFile
		const serviceName = audioFile.track.service.name

		if (isUnifiedAudioObjectKey(objectKey)) {
			skipped++
			continue
		}

		const extension = extractExtension(objectKey)
		const newKey = buildAudioObjectKey(serviceName, trackId, extension)

		if (newKey === objectKey) {
			skipped++
			continue
		}

		try {
			const destExists = await objectExists(s3, config.bucket, newKey)
			const sourceExists = await objectExists(s3, config.bucket, objectKey)

			if (!destExists && sourceExists) {
				console.log(`   copy ${objectKey} → ${newKey}`)
				if (!dryRun) {
					await s3.send(
						new CopyObjectCommand({
							Bucket: config.bucket,
							CopySource: `${config.bucket}/${objectKey}`,
							Key: newKey,
						}),
					)
				}
			} else if (!destExists && !sourceExists) {
				console.warn(`   ⚠️  source missing, updating DB only: ${objectKey} → ${newKey}`)
			} else {
				console.log(`   dest already exists, updating DB: ${newKey}`)
			}

			if (!dryRun) {
				await prisma.trackAudioFile.update({
					where: { id },
					data: { objectKey: newKey, fileName: newKey.split('/').pop() },
				})
			}

			if (sourceExists && objectKey !== newKey) {
				console.log(`   delete ${objectKey}`)
				if (!dryRun) {
					await s3.send(
						new DeleteObjectCommand({
							Bucket: config.bucket,
							Key: objectKey,
						}),
					)
				}
			}

			migrated++
		} catch (error) {
			errors++
			console.error(`   ❌ failed ${objectKey}:`, error)
		}
	}

	await prisma.$disconnect()

	console.log('')
	console.log(`✅ Done — migrated: ${migrated}, skipped: ${skipped}, errors: ${errors}`)
	if (dryRun) {
		console.log('(dry run — no changes written)')
	}
}

migrateAudioObjectKeys().catch((error) => {
	console.error('Fatal error:', error)
	process.exit(1)
})
