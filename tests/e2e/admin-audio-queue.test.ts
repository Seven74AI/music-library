/**
 * E2E tests for the admin audio-queue dashboard.
 * Pattern follows tests/e2e/youtube-cookies.test.ts.
 */
import { test, expect } from '#tests/playwright-utils.ts'

test.describe('Audio Queue Admin Page', { tag: '@slow' }, () => {
	test('admin can view the audio queue dashboard', async ({ page, loginAsAdmin }) => {
		await loginAsAdmin()
		await page.goto('/admin/audio-queue')
		await page.waitForLoadState('domcontentloaded')

		// Page header
		await expect(page.getByRole('heading', { name: /audio archive queue/i })).toBeVisible()

		// Worker control section
		await expect(page.getByText(/worker control/i)).toBeVisible()

		// Queue stats
		await expect(page.getByText(/pending/i).first()).toBeVisible()
		await expect(page.getByText(/processing/i).first()).toBeVisible()
		await expect(page.getByText(/completed/i).first()).toBeVisible()
		await expect(page.getByText(/failed/i).first()).toBeVisible()
		await expect(page.getByText(/success rate/i)).toBeVisible()

		// Track queue table heading
		await expect(page.getByRole('heading', { name: /track queue/i })).toBeVisible()
	})

	test('admin can see pause button when worker is running', async ({ page, loginAsAdmin }) => {
		await loginAsAdmin()
		await page.goto('/admin/audio-queue')
		await page.waitForLoadState('domcontentloaded')

		// Pause button should be visible when running
		const pauseButton = page.getByRole('button', { name: /pause/i })
		await expect(pauseButton).toBeVisible()
	})

	test('admin can see filter buttons for all statuses', async ({ page, loginAsAdmin }) => {
		await loginAsAdmin()
		await page.goto('/admin/audio-queue')
		await page.waitForLoadState('domcontentloaded')

		// All filter buttons
		await expect(page.getByRole('button', { name: /^all$/i })).toBeVisible()
		await expect(page.getByRole('button', { name: /^pending$/i })).toBeVisible()
		await expect(page.getByRole('button', { name: /^processing$/i })).toBeVisible()
		await expect(page.getByRole('button', { name: /^completed$/i })).toBeVisible()
		await expect(page.getByRole('button', { name: /^failed$/i })).toBeVisible()
	})

	test('non-admin user gets 403', async ({ page, login }) => {
		await login()
		await page.goto('/admin/audio-queue')
		await page.waitForLoadState('domcontentloaded')

		// Should see 403 error
		await expect(page.getByText(/you must be an admin/i)).toBeVisible()
	})

	test('admin can pause and resume the worker', async ({ page, loginAsAdmin }) => {
		await loginAsAdmin()
		await page.goto('/admin/audio-queue')
		await page.waitForLoadState('domcontentloaded')

		// Click pause
		await page.getByRole('button', { name: /pause/i }).click()
		await page.waitForLoadState('domcontentloaded')

		// Should now show paused status
		await expect(page.getByText(/paused/i)).toBeVisible()

		// Should now show resume button
		await expect(page.getByRole('button', { name: /resume/i })).toBeVisible()

		// Click resume
		await page.getByRole('button', { name: /resume/i }).click()
		await page.waitForLoadState('domcontentloaded')

		// Should be back to running
		await expect(page.getByText(/running/i)).toBeVisible()
	})

	test('admin can filter tracks by status', async ({ page, loginAsAdmin }) => {
		await loginAsAdmin()
		await page.goto('/admin/audio-queue')
		await page.waitForLoadState('domcontentloaded')

		// Click the Pending filter
		await page.getByRole('button', { name: /^pending$/i }).click()
		await page.waitForLoadState('domcontentloaded')

		// URL should have status parameter
		await expect(page).toHaveURL(/status=pending/)

		// The Pending button should now be the active/default variant
		// (we just verify the filter worked, not the button style)
	})

	test('table columns are visible', async ({ page, loginAsAdmin }) => {
		await loginAsAdmin()
		await page.goto('/admin/audio-queue')
		await page.waitForLoadState('domcontentloaded')

		await expect(page.getByRole('columnheader', { name: /track/i })).toBeVisible()
		await expect(page.getByRole('columnheader', { name: /artist/i })).toBeVisible()
		await expect(page.getByRole('columnheader', { name: /service/i })).toBeVisible()
		await expect(page.getByRole('columnheader', { name: /status/i })).toBeVisible()
		await expect(page.getByRole('columnheader', { name: /retries/i })).toBeVisible()
		await expect(page.getByRole('columnheader', { name: /latest error/i })).toBeVisible()
		await expect(page.getByRole('columnheader', { name: /last attempt/i })).toBeVisible()
		await expect(page.getByRole('columnheader', { name: /actions/i })).toBeVisible()
	})
})
