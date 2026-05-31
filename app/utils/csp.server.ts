/**
 * Content Security Policy utility module.
 *
 * Generates a Content-Security-Policy header to override Fly.io's bare
 * `default-src 'none'` with explicit script-src and frame-ancestors directives.
 *
 * Uses the existing nonce infrastructure already plumbed through the React tree.
 */

const DIRECTIVES = {
	'default-src': "'none'",
	'frame-ancestors': "'none'",
} as const

/**
 * Generate a Content-Security-Policy header string using the provided nonce.
 *
 * The nonce gates inline script execution — only scripts with a matching nonce
 * attribute are allowed to execute.
 */
export function createCSP(nonce: string): string {
	return [
		`default-src ${DIRECTIVES['default-src']}`,
		`script-src 'self' 'nonce-${nonce}'`,
		`frame-ancestors ${DIRECTIVES['frame-ancestors']}`,
	].join('; ')
}
