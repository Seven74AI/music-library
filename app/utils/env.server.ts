import { z } from 'zod'

// Helper function to create conditional validation
const createConditionalSchema = (): z.ZodObject<any> => {
  const isMocksEnabled: boolean = process.env.MOCKS === 'true'
  
  return z.object({
    NODE_ENV: z.enum(['production', 'development', 'test'] as const),
    DATABASE_PATH: z.string(),
    DATABASE_URL: z.string(),
    SESSION_SECRET: z.string(),
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

    // Audio Archive Configuration
    AUDIO_ARCHIVE_ENABLED: z.enum(['true', 'false']).optional(),
    AUDIO_ARCHIVE_MAX_CONCURRENT: z.string().optional(), // Default: '2'
    AUDIO_ARCHIVE_INTERVAL_MS: z.string().optional(), // Default: '300000' (5 min)
  })
}

const schema = createConditionalSchema()

declare global {
	namespace NodeJS {
		interface ProcessEnv extends z.infer<typeof schema> {}
	}
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
