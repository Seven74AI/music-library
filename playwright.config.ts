import { defineConfig, devices } from '@playwright/test'
import 'dotenv/config'

const PORT = process.env.PORT || '3000'

export default defineConfig({
	testDir: './tests/e2e',
	timeout: 15 * 1000, // Reduced from 20s to 15s
	expect: {
		timeout: 5 * 1000, // Reduced from 10s to 5s
	},
	fullyParallel: true,
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
					],
				},
			},
		},
	],

	webServer: {
		command: process.env.CI ? 'npm run start:mocks' : 'npm run dev',
		port: Number(PORT),
		reuseExistingServer: true,
		stdout: 'pipe',
		stderr: 'pipe',
		timeout: 60 * 1000, // Server timeout
		env: {
			PORT,
			NODE_ENV: 'test',
			MOCKS: 'true',
			YOUTUBE_MOCKS: 'true',
		},
	},
})
