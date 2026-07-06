import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { envOnlyMacros } from 'vite-env-only'
import { iconsSpritesheet } from 'vite-plugin-icons-spritesheet'

const MODE = process.env.NODE_ENV

/**
 * Strips Sentry monitoring imports from the client bundle at build time
 * when SENTRY_DSN is not set, preventing the 182KB+ monitoring chunk from
 * being included in production builds that don't use Sentry.
 */
function stripMonitoringWhenNoDSN() {
	let isProductionWithoutDSN = false

	return {
		name: 'strip-monitoring-when-no-dsn',
		enforce: 'pre',
		configResolved() {
			isProductionWithoutDSN =
				MODE === 'production' && !process.env.SENTRY_DSN
		},
		transform(code: string, id: string) {
			if (!isProductionWithoutDSN) return null

			// Strip monitoring init from entry.client.tsx
			if (id.includes('entry.client')) {
				const stripped = code.replace(
					/if\s*\(ENV\.MODE\s*===\s*'production'\s*&&\s*ENV\.SENTRY_DSN\)\s*\{[\s\S]*?\n\s*\}/,
					'// Sentry monitoring stripped: SENTRY_DSN not set at build time',
				)
				if (stripped !== code) return stripped
			}

			// Strip captureException dynamic import from error-boundary.tsx
			if (id.includes('error-boundary')) {
				const stripped = code.replace(
					/if\s*\(ENV\.MODE\s*===\s*'production'\s*&&\s*ENV\.SENTRY_DSN\)\s*\{[\s\S]*?\n\s*\}/,
					'// Sentry captureException stripped: SENTRY_DSN not set at build time',
				)
				if (stripped !== code) return stripped
			}

			return null
		},
	}
}

export default defineConfig((config) => ({
	build: {
		target: 'es2022',
		cssMinify: MODE === 'production',

		rollupOptions: {
			external: [/node:.*/, 'fsevents', '#prisma/client.js'],
			treeshake: {
				preset: 'smallest',
				moduleSideEffects: (id: string) => {
					// These packages are known to be pure — marking them as
					// side-effect-free allows Rollup to eliminate unused exports
					if (id.includes('node_modules/zod/')) return false
					if (id.includes('node_modules/openimg/')) return false
					return true
				},
			},
		},

		assetsInlineLimit: (filePath: string, _content: Buffer): boolean | undefined => {
			if (
				filePath.endsWith('favicon.svg') ||
				filePath.endsWith('apple-touch-icon.png')
			) {
				return false // Don't inline these assets
			}
			return undefined // Use default behavior for other assets
		},

		sourcemap: MODE !== 'production',
	},
	server: {
		watch: {
			ignored: ['**/playwright-report/**'],
		},
	},
	plugins: [
		stripMonitoringWhenNoDSN(),
		envOnlyMacros(),
		tailwindcss(),
		//reactRouterDevTools(),

		iconsSpritesheet({
			inputDir: './other/svg-icons',
			outputDir: './app/components/ui/icons',
			fileName: 'sprite.svg',
			withTypes: true,
			iconNameTransformer: (name) => name,
		}),
		// it would be really nice to have this enabled in tests, but we'll have to
		// wait until https://github.com/remix-run/remix/issues/9871 is fixed
		MODE === 'test' ? null : reactRouter(),
	],
	test: {
		include: ['./app/**/*.test.{ts,tsx}'],
		setupFiles: ['./tests/setup/setup-test-env.ts'],
		globalSetup: ['./tests/setup/global-setup.ts'],
		restoreMocks: true,
		coverage: {
			include: ['app/**/*.{ts,tsx}'],
			all: true,
			thresholds: {
				lines: 6,
				branches: 50,
				functions: 25,
				statements: 6,
			},
		},
	},
}))
