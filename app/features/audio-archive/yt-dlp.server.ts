import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

/**
 * Error categories for yt-dlp failures.
 * These are used to classify errors so the worker can decide
 * whether to retry, skip, or flag for human review.
 */
export const ErrorCategory = {
	AUTH: 'AUTH',
	RATE_LIMITED: 'RATE_LIMITED',
	GEO_BLOCKED: 'GEO_BLOCKED',
	VIDEO_UNAVAILABLE: 'VIDEO_UNAVAILABLE',
	NETWORK: 'NETWORK',
	COOKIE_EXPIRED: 'COOKIE_EXPIRED',
	FILE_NOT_FOUND: 'FILE_NOT_FOUND',
	UNKNOWN: 'UNKNOWN',
} as const

export type ErrorCategory = (typeof ErrorCategory)[keyof typeof ErrorCategory]

/**
 * Result of a yt-dlp execution.
 */
export interface YtDlpExecResult {
	exitCode: number | null
	stdout: string
	stderr: string
	filePath?: string
	errorCategory?: ErrorCategory | null
	errorMessage?: string | null
}

/**
 * Options for yt-dlp execution.
 */
export interface YtDlpExecOptions {
	/** Output directory for downloaded files. Default: os.tmpdir() */
	outputDir?: string
	/** Output template for yt-dlp. Default: '%(id)s.%(ext)s' */
	outputTemplate?: string
	/** Cookie file path for authenticated downloads */
	cookieFile?: string
	/** Timeout in milliseconds. Default: 300000 (5 minutes) */
	timeout?: number
}

const DEFAULT_TIMEOUT = 300_000 // 5 minutes
export const DEFAULT_OUTPUT_TEMPLATE = '%(id)s.%(ext)s'

function buildJsRuntimeArgs(): string[] {
	return ['--js-runtimes', `node:${process.execPath}`]
}

export function buildYtDlpSpawnArgs(
	url: string,
	options: YtDlpExecOptions = {},
): string[] {
	const {
		outputDir,
		outputTemplate = DEFAULT_OUTPUT_TEMPLATE,
		cookieFile,
	} = options

	const args = [
		'--extract-audio',
		'--audio-format', 'mp3',
		'--no-playlist',
		...buildJsRuntimeArgs(),
	]

	if (outputDir) {
		args.push('--paths', outputDir)
	}

	args.push('--output', outputTemplate)

	if (cookieFile) {
		args.push('--cookies', cookieFile)
	}

	args.push(url)
	return args
}

/**
 * Execute yt-dlp to download audio from a YouTube URL.
 *
 * Spawns yt-dlp as a child process with --extract-audio and --audio-format mp3.
 * Results include exit code, stdout, stderr, and error categorization.
 *
 * In MOCKS mode (MOCKS=true env), returns a simulated result without actually
 * spawning yt-dlp — useful for CI and development.
 */
export async function executeYtDlp(
	url: string,
	options: YtDlpExecOptions = {},
): Promise<YtDlpExecResult> {
	const {
		outputDir: outputDirOption,
		outputTemplate = DEFAULT_OUTPUT_TEMPLATE,
		cookieFile,
		timeout = DEFAULT_TIMEOUT,
	} = options
	const outputDir = outputDirOption ?? os.tmpdir()

	// MOCKS mode: return simulated success
	if (process.env.MOCKS === 'true') {
		const mockFilePath = path.join(outputDir, 'abc123.mp3')
		return {
			exitCode: 0,
			stdout: `[download] Destination: ${mockFilePath}\n[download] 100% of 10.00MiB\n[ExtractAudio] Destination: ${mockFilePath}`,
			stderr: '',
			filePath: mockFilePath,
			errorCategory: null,
			errorMessage: null,
		}
	}

	return new Promise((resolve) => {
		const args = buildYtDlpSpawnArgs(url, {
			outputDir,
			outputTemplate,
			cookieFile,
		})

		const child = spawn('yt-dlp', args, {
			stdio: ['ignore', 'pipe', 'pipe'],
			timeout,
		})

		let stdout = ''
		let stderr = ''

		child.stdout?.on('data', (data: Buffer) => {
			stdout += data.toString()
		})

		child.stderr?.on('data', (data: Buffer) => {
			stderr += data.toString()
		})

		child.on('close', (exitCode) => {
			const raw: YtDlpExecResult = {
				exitCode,
				stdout,
				stderr,
				filePath: extractFilePath(stdout, outputDir),
			}

			const categorized = categorizeYtDlpError(raw)
			resolve({ ...raw, ...categorized })
		})

		child.on('error', (err) => {
			resolve({
				exitCode: null,
				stdout,
				stderr: `${stderr}\n${err.message}`,
				errorCategory: categorizeStderr(err.message) ?? 'UNKNOWN',
				errorMessage: err.message,
			})
		})
	})
}

function resolveOutputPath(filePath: string, outputDir?: string): string {
	if (path.isAbsolute(filePath)) return filePath
	if (outputDir) return path.join(outputDir, filePath)
	return path.resolve(filePath)
}

/**
 * Extract the downloaded file path from yt-dlp stdout.
 * Prefers the final ExtractAudio destination (mp3) over the intermediate download (webm).
 */
export function extractFilePath(
	stdout: string,
	outputDir?: string,
): string | undefined {
	const extractMatches = [...stdout.matchAll(/\[ExtractAudio\] Destination: (.+)/g)]
	const extractPath = extractMatches.at(-1)?.[1]?.trim()
	if (extractPath) return resolveOutputPath(extractPath, outputDir)

	const downloadMatches = [...stdout.matchAll(/\[download\] Destination: (.+)/g)]
	const downloadPath = downloadMatches.at(-1)?.[1]?.trim()
	if (downloadPath) return resolveOutputPath(downloadPath, outputDir)

	return undefined
}

/**
 * Categorize a yt-dlp execution result into an error category.
 * Examines both exit code and stderr content.
 */
export function categorizeYtDlpError(
	result: YtDlpExecResult,
): { errorCategory: ErrorCategory | null; errorMessage: string | null } {
	if (result.exitCode === 0) {
		return { errorCategory: null, errorMessage: null }
	}

	const stderrCategory = categorizeStderr(result.stderr)

	if (stderrCategory) {
		return {
			errorCategory: stderrCategory,
			errorMessage: extractErrorMessage(result.stderr),
		}
	}

	// Fallback based on exit code
	return {
		errorCategory: 'UNKNOWN',
		errorMessage: extractErrorMessage(result.stderr) || `yt-dlp exited with code ${result.exitCode}`,
	}
}

/**
 * Categorize yt-dlp stderr output into an error category.
 * Returns null if stderr doesn't match any known error pattern.
 */
export function categorizeStderr(stderr: string): ErrorCategory | null {
	const lower = stderr.toLowerCase().trim()
	if (!lower) return null

	// Check in priority order — first match wins

	// Cookie / sign-in required
	if (
		lower.includes('sign in to confirm') ||
		lower.includes('sign-in required') ||
		lower.includes('cookie')
	) {
		return 'COOKIE_EXPIRED'
	}

	// CDN-level block (media download, not auth — e.g. "unable to download video data: HTTP Error 403")
	// These are transient infrastructure blocks, not credential failures
	if (
		lower.includes('unable to download video data') ||
		lower.includes('unable to extract video data')
	) {
		return 'NETWORK'
	}

	// Authentication errors (403/forbidden at the webpage/auth layer)
	if (
		lower.includes('http error 403') ||
		lower.includes('forbidden') ||
		lower.includes('login required')
	) {
		return 'AUTH'
	}

	// Rate limiting
	if (
		lower.includes('http error 429') ||
		lower.includes('too many requests') ||
		lower.includes('rate limit')
	) {
		return 'RATE_LIMITED'
	}

	// Geo-blocking
	if (
		lower.includes('not available in your country') ||
		lower.includes('geo-restricted') ||
		lower.includes('blocked in your country')
	) {
		return 'GEO_BLOCKED'
	}

	// Video unavailable
	if (
		lower.includes('video unavailable') ||
		lower.includes('video has been removed') ||
		lower.includes('this video is private') ||
		lower.includes('this video is not available')
	) {
		return 'VIDEO_UNAVAILABLE'
	}

	// Network errors
	if (
		lower.includes('unable to connect') ||
		lower.includes('temporary failure in name resolution') ||
		lower.includes('connection refused') ||
		lower.includes('network is unreachable') ||
		lower.includes('getaddrinfo') ||
		lower.includes('econnrefused') ||
		lower.includes('etimedout') ||
		lower.includes('enotfound')
	) {
		return 'NETWORK'
	}

	return null
}

/**
 * Extract a human-readable error message from yt-dlp stderr.
 * Strips ANSI escape codes and returns the most relevant line.
 */
function extractErrorMessage(stderr: string): string | null {
	const clean = stderr
		.replace(/\x1b\[[0-9;]*m/g, '') // strip ANSI
		.trim()

	if (!clean) return null

	// Prefer ERROR: lines
	const errorLine = clean.split('\n').find((l) => l.includes('ERROR:'))
	if (errorLine) return errorLine.trim()

	// Fall back to first non-empty line
	return clean.split('\n').find((l) => l.trim())?.trim() ?? null
}

/**
 * Parse the download progress percentage from yt-dlp output.
 * Returns null if no progress line is found.
 */
export function parseYtDlpProgress(output: string): number | null {
	const match = output.match(/\[download\]\s+(\d+(?:\.\d+)?)%/)
	if (match?.[1]) {
		return parseFloat(match[1])
	}
	return null
}

/**
 * Build the yt-dlp command args for inspection or logging.
 * Useful for debugging.
 */
export function buildYtDlpArgs(url: string, options: YtDlpExecOptions = {}): string[] {
	return ['yt-dlp', ...buildYtDlpSpawnArgs(url, options)]
}
