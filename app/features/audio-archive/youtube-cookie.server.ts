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

// ── Private helpers ──────────────────────────────────────────────

function cookieFilePath(): string {
	return process.env.COOKIE_FILE_PATH ?? '/data/youtube-cookies.txt'
}

function serializeLine(cookie: NetscapeCookie): string {
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

// ── Public API ───────────────────────────────────────────────────

/**
 * Parse a single Netscape-format cookie line.
 * Returns null for comments, blank lines, or unparseable lines.
 */
export function parseCookieLine(line: string): NetscapeCookie | null {
	const trimmed = line.trim()

	if (trimmed === '' || trimmed.startsWith('#')) return null

	const parts = trimmed.split('\t')
	if (parts.length !== 7) return null

	const [domain, flag, pathStr, secure, expiresStr, name, value] = parts

	if (flag !== 'TRUE' && flag !== 'FALSE') return null
	if (secure !== 'TRUE' && secure !== 'FALSE') return null

	const expires = parseInt(expiresStr!, 10)
	if (isNaN(expires) || expires < 0) return null

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
 * Write cookies to a Netscape-format file.  Creates the parent directory
 * if it doesn't exist.  Pass an empty array to delete the cookie file.
 */
export function writeCookies(
	cookies: NetscapeCookie[],
	filePath?: string,
): void {
	const targetPath = filePath ?? cookieFilePath()

	if (cookies.length === 0) {
		if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath)
		return
	}

	const dir = path.dirname(targetPath)
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

	const lines = [...HEADER_LINES, ...cookies.map(serializeLine), '']
	fs.writeFileSync(targetPath, lines.join('\n'), 'utf-8')
}

/**
 * Read cookies from a Netscape-format file.
 * Returns an empty array if the file doesn't exist.
 */
export function readCookies(filePath?: string): NetscapeCookie[] {
	const targetPath = filePath ?? cookieFilePath()

	if (!fs.existsSync(targetPath)) return []

	const content = fs.readFileSync(targetPath, 'utf-8')
	const cookies: NetscapeCookie[] = []

	for (const line of content.split('\n')) {
		const cookie = parseCookieLine(line)
		if (cookie) cookies.push(cookie)
	}

	return cookies
}
