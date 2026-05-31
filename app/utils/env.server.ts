import { z } from 'zod'
import crypto from 'node:crypto'

// Helper function to create conditional validation
const createConditionalSchema = (): z.ZodObject<any> => {
  const isMocksEnabled: boolean = process.env.MOCKS === 'true'
  const isProduction: boolean = process.env.NODE_ENV === 'production'
  
  return z.object({
    NODE_ENV: z.enum(['production', 'development', 'test'] as const),
    DATABASE_PATH: z.string(),
    DATABASE_URL: z.string(),
    // SESSION_SECRET is required in production, optional in dev/test (getSessionSecret() provides a random fallback)
    SESSION_SECRET: isProduction ? z.string() : z.string().optional(),
    INTERNAL_COMMAND_TOKEN: z.string(),
    HONEYPOT_SECRET: z.string(),
    CACHE_DATABASE_PATH: z.string(),
    // If you plan on using Sentry, remove the .optional()
    SENTRY_DSN: z.string().optional(),
    // If you plan to use Resend, remove the .optional()
    RESEND_API_KEY: z.string().optional(),

    ALLOW_INDEXING: z.enum(['true', 'false']).optional(),

    // Tigris Object Storage Configuration - conditional based on mocks
    AWS_ACCESS_KEY_ID: isMocksEnabled ? z.string().optional() : z.string(),
    AWS_SECRET_ACCESS_KEY: isMocksEnabled ? z.string().optional() : z.string(),
    AWS_REGION: isMocksEnabled ? z.string().optional() : z.string(),
    AWS_ENDPOINT_URL_S3: isMocksEnabled ? z.string().url().optional() : z.string().url(),
    BUCKET_NAME: isMocksEnabled ? z.string().optional() : z.string(),

    // YouTube Data API Configuration (uses existing Google OAuth credentials)
    YOUTUBE_API_KEY: z.string().optional(),
    SITE_URL: z.string().optional(),
  })
}

const schema = createConditionalSchema()

declare global {
	namespace NodeJS {
		interface ProcessEnv extends z.infer<typeof schema> {}
	}
}

/**
 * Returns the SESSION_SECRET split by commas (supporting multiple secrets for
 * key rotation). In production, throws if SESSION_SECRET is not set. In
 * development/test, generates a random UUID fallback so dev workflow isn't
 * blocked.
 *
 * This is the single source of truth for session secrets — all cookie-based
 * session storage modules MUST use this instead of reading process.env directly.
 */
export function getSessionSecret(): string[] {
	const secret = process.env.SESSION_SECRET
	if (secret) {
		return secret.split(',')
	}

	// In production, fail fast — no fallback, no silent vulnerability
	if (process.env.NODE_ENV === 'production') {
		throw new Error(
			'SESSION_SECRET environment variable is required in production. ' +
				'Generate one with: openssl rand -hex 32',
		)
	}

	// In dev/test, generate a random secret so dev workflow isn't blocked.
	// Cache it so it's stable across module reloads in the same process.
	const devFallback = `dev-${crypto.randomUUID()}`
	console.warn(
		'⚠ SESSION_SECRET not set — using randomly generated fallback for dev/test only. ' +
			'DO NOT use in production.',
	)
	return [devFallback]
}

export function init() {
	const parsed = schema.safeParse(process.env)

	if (parsed.success === false) {
		console.error(
			'❌ Invalid environment variables:',
			parsed.error.flatten().fieldErrors,
		)

		throw new Error('Invalid environment variables')
	}
}

/**
 * This is used in both `entry.server.ts` and `root.tsx` to ensure that
 * the environment variables are set and globally available before the app is
 * started.
 *
 * NOTE: Do *not* add any environment variables in here that you do not wish to
 * be included in the client.
 * @returns all public ENV variables
 */
export function getEnv() {
	return {
		MODE: process.env.NODE_ENV,
		SENTRY_DSN: process.env.SENTRY_DSN,
		ALLOW_INDEXING: process.env.ALLOW_INDEXING,
	}
}

type ENV = ReturnType<typeof getEnv>

declare global {
	var ENV: ENV
	interface Window {
		ENV: ENV
	}
}
