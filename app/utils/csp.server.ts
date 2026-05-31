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
	'script-src': "'self'",
	'style-src': "'self' 'unsafe-inline'",
	'img-src': "'self' data:",
	'connect-src': "'self'",
	'font-src': "'self'",
	'media-src': "'self'",
	'frame-ancestors': "'none'",
} as const

/**
 * Generate a Content-Security-Policy header string using the provided nonce.
 *
 * The nonce gates inline script execution — only scripts with a matching nonce
 * attribute are allowed to execute. Additional directives allow styles, images,
 * API connections, fonts, and media so the app functions correctly.
 */
export function createCSP(nonce: string): string {
	return [
		`default-src ${DIRECTIVES['default-src']}`,
		`script-src ${DIRECTIVES['script-src']} 'nonce-${nonce}'`,
		`style-src ${DIRECTIVES['style-src']}`,
		`img-src ${DIRECTIVES['img-src']}`,
		`connect-src ${DIRECTIVES['connect-src']}`,
		`font-src ${DIRECTIVES['font-src']}`,
		`media-src ${DIRECTIVES['media-src']}`,
		`frame-ancestors ${DIRECTIVES['frame-ancestors']}`,
	].join('; ')
}
