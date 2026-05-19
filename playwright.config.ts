import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// Set DATABASE_URL for the test process BEFORE any other imports
// This ensures it's available when test files import prisma from db.server.ts
// This must be set before 'dotenv/config' to ensure it takes precedence
const BASE_DATABASE_PATH = path.join(process.cwd(), './tests/prisma/base.db')
process.env.DATABASE_URL = `file:${BASE_DATABASE_PATH}`

// Now load dotenv (which won't override DATABASE_URL if it's already set)
import 'dotenv/config'

const PORT = process.env.PORT || '3000'

export default defineConfig({
	testDir: './tests/e2e',
	timeout: 15 * 1000, // Reduced from 20s to 15s
	expect: {
		timeout: 5 * 1000, // Reduced from 10s to 5s
	},
	fullyParallel: true,
	maxFailures: process.env.CI ? 10 : 0,
	globalTimeout: 30 * 60 * 1000, // 30 min global timeout
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : 2,
	reporter: process.env.CI ? 'github' : 'html', // GitHub integration in CI, detailed reports locally
	globalSetup: './tests/setup/global-setup.ts',
	use: {
		baseURL: `http://localhost:${PORT}/`,
		trace: 'on-first-retry',
		// Performance optimizations
		actionTimeout: 5 * 1000,
		navigationTimeout: 10 * 1000,
		// Disable expensive features
		video: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},

	projects: [
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				// Browser optimizations
				launchOptions: {
					args: [
						'--disable-dev-shm-usage',
						'--disable-extensions',
						'--disable-background-timer-throttling',
						'--disable-backgrounding-occluded-windows',
						'--disable-renderer-backgrounding',
						'--disable-gpu',
					],
				},
			},
		},
	],

	webServer: {
		command: process.env.CI ? 'npm run start:mocks' : 'npm run dev',
		port: Number(PORT),
		reuseExistingServer: !!process.env.CI, // Reuse server in CI (sharding-friendly)
		stdout: 'pipe',
		stderr: 'pipe',
		timeout: 60 * 1000, // Server timeout
		env: {
			PORT,
			NODE_ENV: 'test',
			MOCKS: 'true',
			YOUTUBE_MOCKS: 'true',
			// Use the test database created by global setup (absolute path)
			// This ensures the webServer uses the same database as the global setup
			DATABASE_URL: `file:${BASE_DATABASE_PATH}`,
		},
	},
})
