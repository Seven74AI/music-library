import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { invariantResponse } from '@epic-web/invariant'
import { lookup as getMimeType } from 'mime-types'
import { http, HttpResponse } from 'msw'

// Ensure we have a valid URL by explicitly creating it from the import.meta.url
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures')
const MOCK_STORAGE_DIR = path.join(FIXTURES_DIR, 'uploaded')
const FIXTURES_IMAGES_DIR = path.join(FIXTURES_DIR, 'images')
const STORAGE_ENDPOINT = process.env.AWS_ENDPOINT_URL_S3
const STORAGE_BUCKET = process.env.BUCKET_NAME
// const STORAGE_ACCESS_KEY = process.env.AWS_ACCESS_KEY_ID // Used in URL construction

function validateAuth(headers: Headers) {
	// AWS SDK v3 uses different headers than manual signing
	// For mocking purposes, we'll accept any request with basic auth headers
	const authHeader = headers.get('Authorization')
	// const amzDate = headers.get('X-Amz-Date') // Used for AWS signature validation
	// const amzContentSha256 = headers.get('X-Amz-Content-SHA256') // Used for AWS signature validation
	
	// Check for AWS SDK v3 headers (more flexible validation)
	if (authHeader && authHeader.startsWith('AWS4-HMAC-SHA256')) {
		return true
	}
	
	// Also accept requests with basic auth headers (AWS SDK v3 might use these)
	if (authHeader && (authHeader.includes('AWS') || authHeader.includes('Credential='))) {
		return true
	}
	
	// For development, be more permissive
	if (process.env.NODE_ENV === 'development') {
		return true
	}

	return false
}

function assertKey(key: any): asserts key is Array<string> {
	invariantResponse(
		Array.isArray(key) && key.length && key.every((k) => typeof k === 'string'),
		'Key must contain a directory',
	)
}

export const handlers = [
	http.put(
		`${STORAGE_ENDPOINT}/${STORAGE_BUCKET}/:key*`,
		async ({ request, params }) => {
			if (!validateAuth(request.headers)) {
				return new HttpResponse('Unauthorized', { status: 401 })
			}
			const { key } = params

			assertKey(key)

			const filePath = path.join(MOCK_STORAGE_DIR, ...key)
			const parentDir = path.dirname(filePath)
			await fs.mkdir(parentDir, { recursive: true })

			const fileBuffer = Buffer.from(await request.arrayBuffer())
			await fs.writeFile(filePath, fileBuffer)

			return new HttpResponse(null, { status: 201 })
		},
	),

	http.get(
		`${STORAGE_ENDPOINT}/${STORAGE_BUCKET}/:key*`,
		async ({ params }) => {
			const { key } = params
			assertKey(key)

			const filePath = path.join(MOCK_STORAGE_DIR, ...key)
			try {
				// Check tests/fixtures/images directory first
				const testFixturesPath = path.join(FIXTURES_IMAGES_DIR, ...key)
				let file: Buffer
				try {
					file = await fs.readFile(testFixturesPath)
				} catch {
					// If not found in test fixtures, try original path
					file = await fs.readFile(filePath)
				}

				const contentType =
					getMimeType(key.at(-1) || '') || 'application/octet-stream'
				return new HttpResponse(file, {
					headers: {
						'Content-Type': contentType,
						'Content-Length': file.length.toString(),
						'Cache-Control': 'public, max-age=31536000, immutable',
					},
				})
			} catch {
				return new HttpResponse('Not found', { status: 404 })
			}
		},
	),

	http.delete(
		`${STORAGE_ENDPOINT}/${STORAGE_BUCKET}/:key*`,
		async ({ request, params }) => {
			if (!validateAuth(request.headers)) {
				return new HttpResponse('Unauthorized', { status: 401 })
			}
			const { key } = params

			assertKey(key)

			const filePath = path.join(MOCK_STORAGE_DIR, ...key)
			try {
				await fs.unlink(filePath)
				return new HttpResponse(null, { status: 204 })
			} catch {
				// File doesn't exist, but that's okay for DELETE
				return new HttpResponse(null, { status: 204 })
			}
		},
	),
]
