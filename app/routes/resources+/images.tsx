import { promises as fs, constants, existsSync } from 'node:fs'
import { join } from 'node:path'
import { invariantResponse } from '@epic-web/invariant'
import { getImgResponse } from 'openimg/node'
import { getDomainUrl } from '#app/utils/misc.tsx'
import { validateStorageKey } from '#app/utils/path-validation.server'
import { getFileUrl } from '#app/utils/storage.server.ts'
import { type Route } from './+types/images'

let cacheDir: string | null = null

async function getCacheDir() {
	if (cacheDir) return cacheDir

	let dir = './tests/fixtures/openimg'
	if (process.env.NODE_ENV === 'production') {
		const isAccessible = await fs
			.access('/data', constants.W_OK)
			.then(() => true)
			.catch(() => false)

		if (isAccessible) {
			dir = '/data/images'
		}
	}

	return (cacheDir = dir)
}

/**
 * Check if a string is a storage key (not a URL)
 * Storage keys typically start with 'images/' or 'audio/' and don't contain '://'
 */
function isStorageKey(value: string): boolean {
	// If it's a valid URL, it's not a storage key
	if (URL.canParse(value)) {
		return false
	}
	// Storage keys typically start with 'images/' or 'audio/'
	return value.startsWith('images/') || value.startsWith('audio/')
}

export async function loader({ request }: Route.LoaderArgs) {
	const url = new URL(request.url)
	const searchParams = url.searchParams

	const headers = new Headers()
	headers.set('Cache-Control', 'public, max-age=31536000, immutable')

	const objectKey = searchParams.get('objectKey')
	
	// Validate objectKey if provided
	if (objectKey && (typeof objectKey !== 'string' || objectKey.trim().length === 0)) {
		throw new Response('Invalid objectKey parameter', { status: 400 })
	}

	return getImgResponse(request, {
		headers,
		allowlistedOrigins: [
			getDomainUrl(request),
			process.env.AWS_ENDPOINT_URL_S3,
			'https://i.ytimg.com',
			'https://img.youtube.com',
		].filter(Boolean),
		cacheFolder: await getCacheDir(),
		getImgSource: async () => {
			// If objectKey is explicitly provided, use it
			if (objectKey) {
				// Validate and sanitize the storage key to prevent path traversal
				const validatedKey = validateStorageKey(objectKey)
				
				// Check for local file first (for local development)
				const localFilePath = join(process.cwd(), 'tests', 'fixtures', 'uploaded', validatedKey)
				if (existsSync(localFilePath)) {
					// Serve from local filesystem
					return {
						type: 'fs',
						path: localFilePath,
					}
				}

				// Generate signed URL for remote storage (Tigris/S3)
				// Only if storage is configured (otherwise file should be in local filesystem)
				try {
					const { url: signedUrl, headers: signedHeaders } =
						await getFileUrl(validatedKey, 3600)
					return {
						type: 'fetch',
						url: signedUrl,
						headers: signedHeaders,
					}
				} catch (error) {
					// If storage is not configured and file not found locally, return 404
					const errorMessage = error instanceof Error ? error.message : String(error)
					if (errorMessage.includes('Storage is not configured')) {
						console.warn(`File not found locally and storage not configured: ${validatedKey}`)
						throw new Response('Image not found', { status: 404 })
					}
					console.error('Error generating signed URL for image:', error)
					throw new Response('Failed to generate image URL', { status: 500 })
				}
			}

			const src = searchParams.get('src')
			invariantResponse(src, 'src query parameter is required', { status: 400 })

			// Check if src is a storage key (for local dev and Tigris)
			if (isStorageKey(src)) {
				// Validate and sanitize the storage key to prevent path traversal
				const validatedKey = validateStorageKey(src)
				
				// Check for local file first (for local development)
				const localFilePath = join(process.cwd(), 'tests', 'fixtures', 'uploaded', validatedKey)
				if (existsSync(localFilePath)) {
					// Serve from local filesystem
					return {
						type: 'fs',
						path: localFilePath,
					}
				}

				// Generate signed URL for remote storage (Tigris/S3)
				// Only if storage is configured (otherwise file should be in local filesystem)
				try {
					const { url: signedUrl, headers: signedHeaders } =
						await getFileUrl(validatedKey, 3600)
					return {
						type: 'fetch',
						url: signedUrl,
						headers: signedHeaders,
					}
				} catch (error) {
					// If storage is not configured and file not found locally, return 404
					const errorMessage = error instanceof Error ? error.message : String(error)
					if (errorMessage.includes('Storage is not configured')) {
						console.warn(`File not found locally and storage not configured: ${validatedKey}`)
						throw new Response('Image not found', { status: 404 })
					}
					console.error('Error generating signed URL for storage key:', error)
					throw new Response('Failed to generate image URL from storage key', { status: 500 })
				}
			}

			if (URL.canParse(src)) {
				// Fetch image from external URL; will be matched against allowlist
				return {
					type: 'fetch',
					url: src,
				}
			}
			// Retrieve image from filesystem (public folder)
			if (src.startsWith('/assets')) {
				// Files managed by Vite
				return {
					type: 'fs',
					path: '.' + src,
				}
			}
			// Fallback to files in public folder
			return {
				type: 'fs',
				path: './public' + src,
			}
		},
	})
}
