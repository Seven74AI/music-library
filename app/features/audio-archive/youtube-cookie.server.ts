import fs from 'node:fs'
import path from 'node:path'

/**
 * Represents a single cookie entry in Netscape format.
 *
 * Netscape cookie file format:
 *   domain  flag  path  secure  expires  name  value
 *
 * - domain: The domain the cookie belongs to (e.g. ".youtube.com")
 * - flag:   TRUE if valid for all machines in domain, FALSE otherwise
 * - path:   Cookie path (usually "/")
 * - secure: TRUE if cookie requires HTTPS
 * - expires: Unix timestamp (seconds since epoch), 0 for session cookies
 */
export interface NetscapeCookie {
	domain: string
	flag: 'TRUE' | 'FALSE'
	path: string
	secure: 'TRUE' | 'FALSE'
	expires: number // Unix timestamp (seconds), 0 = session
	name: string
	value: string
}

const HEADER_LINES = ['# Netscape HTTP Cookie File', '# This is a generated file! Do not edit.', '#']

/**
 * Default cookie file path. Override via COOKIE_FILE_PATH env var.
 */
export function getCookieFilePath(): string {
	return process.env.COOKIE_FILE_PATH ?? '/data/youtube-cookies.txt'
}

/**
 * Serialize a single cookie to a Netscape-format line.
 */
export function serializeCookieLine(cookie: NetscapeCookie): string {
	return [
		cookie.domain,
		cookie.flag,
		cookie.path,
		cookie.secure,
		String(cookie.expires),
		cookie.name,
		cookie.value,
	].join('\t')
}

/**
 * Parse a single Netscape-format cookie line back into a cookie object.
 * Returns null if the line is a comment, blank, or cannot be parsed.
 */
export function parseCookieLine(line: string): NetscapeCookie | null {
	const trimmed = line.trim()

	// Skip comments and blank lines
	if (trimmed === '' || trimmed.startsWith('#')) {
		return null
	}

	const parts = trimmed.split('\t')

	// Netscape format requires exactly 7 tab-separated fields
	if (parts.length !== 7) {
		return null
	}

	const [domain, flag, pathStr, secure, expiresStr, name, value] = parts

	// Validate flag
	if (flag !== 'TRUE' && flag !== 'FALSE') {
		return null
	}

	// Validate secure
	if (secure !== 'TRUE' && secure !== 'FALSE') {
		return null
	}

	const expires = parseInt(expiresStr, 10)
	if (isNaN(expires) || expires < 0) {
		return null
	}

	return {
		domain: domain!,
		flag: flag as 'TRUE' | 'FALSE',
		path: pathStr!,
		secure: secure as 'TRUE' | 'FALSE',
		expires,
		name: name!,
		value: value!,
	}
}

/**
 * Write an array of cookies to a Netscape-format cookie file.
 *
 * Creates the parent directory if it doesn't exist.
 * Overwrites the file if it already exists.
 *
 * @param cookies - Array of cookies to write
 * @param filePath - Target file path (defaults to getCookieFilePath())
 */
export function writeCookiesFile(
	cookies: NetscapeCookie[],
	filePath?: string,
): void {
	const targetPath = filePath ?? getCookieFilePath()

	// Ensure parent directory exists
	const dir = path.dirname(targetPath)
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true })
	}

	const lines = [
		...HEADER_LINES,
		...cookies.map(serializeCookieLine),
		'', // trailing newline
	]

	fs.writeFileSync(targetPath, lines.join('\n'), 'utf-8')
}

/**
 * Read cookies from a Netscape-format cookie file.
 *
 * Returns an empty array if the file doesn't exist.
 *
 * @param filePath - Source file path (defaults to getCookieFilePath())
 */
export function readCookiesFile(filePath?: string): NetscapeCookie[] {
	const targetPath = filePath ?? getCookieFilePath()

	if (!fs.existsSync(targetPath)) {
		return []
	}

	const content = fs.readFileSync(targetPath, 'utf-8')
	const lines = content.split('\n')

	const cookies: NetscapeCookie[] = []
	for (const line of lines) {
		const cookie = parseCookieLine(line)
		if (cookie) {
			cookies.push(cookie)
		}
	}

	return cookies
}

/**
 * Convert key-value pairs to Netscape-format cookies for a given domain.
 * Useful when loading raw cookie strings from environment or database.
 *
 * @param domain - Cookie domain (e.g. ".youtube.com")
 * @param cookies - Map of cookie name → value
 * @param options - Optional overrides for flag, path, secure, expires
 */
export function cookiesFromKeyValues(
	domain: string,
	cookies: Record<string, string>,
	options?: {
		flag?: 'TRUE' | 'FALSE'
		path?: string
		secure?: 'TRUE' | 'FALSE'
		expires?: number
	},
): NetscapeCookie[] {
	return Object.entries(cookies).map(([name, value]) => ({
		domain,
		flag: options?.flag ?? 'TRUE',
		path: options?.path ?? '/',
		secure: options?.secure ?? 'TRUE',
		expires: options?.expires ?? 0,
		name,
		value,
	}))
}

/**
 * Delete the cookie file if it exists.
 *
 * @param filePath - Target file path (defaults to getCookieFilePath())
 */
export function deleteCookiesFile(filePath?: string): void {
	const targetPath = filePath ?? getCookieFilePath()

	if (fs.existsSync(targetPath)) {
		fs.unlinkSync(targetPath)
	}
}
