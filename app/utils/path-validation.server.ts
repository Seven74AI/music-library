// @context7: path, path traversal security
import { resolve, normalize } from 'node:path'

/**
 * Validates and sanitizes a storage key to prevent path traversal attacks
 * 
 * @param key - The storage key to validate
 * @param baseDir - The base directory that the key must stay within (default: 'tests/fixtures/uploaded')
 * @returns The validated and normalized key
 * @throws Error if the key contains path traversal sequences or is invalid
 */
export function validateStorageKey(
	key: string,
	baseDir: string = 'tests/fixtures/uploaded'
): string {
	if (!key || typeof key !== 'string') {
		throw new Error('Storage key must be a non-empty string')
	}

	// Reject keys containing path traversal sequences
	if (key.includes('..')) {
		throw new Error('Storage key cannot contain path traversal sequences (..)')
	}

	// Reject null bytes
	if (key.includes('\0')) {
		throw new Error('Storage key cannot contain null bytes')
	}

	// Normalize path separators (convert backslashes to forward slashes)
	const normalizedKey = normalize(key).replace(/\\/g, '/')

	// Reject absolute paths
	if (normalizedKey.startsWith('/')) {
		throw new Error('Storage key cannot be an absolute path')
	}

	// Resolve the full path and verify it stays within base directory
	const basePath = resolve(process.cwd(), baseDir)
	const resolvedPath = resolve(basePath, normalizedKey)

	// Ensure resolved path is within base directory
	if (!resolvedPath.startsWith(basePath)) {
		throw new Error('Storage key resolves outside the base directory')
	}

	return normalizedKey
}

