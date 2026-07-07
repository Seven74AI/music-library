import { test, expect } from '#tests/playwright-utils.ts'

test.describe('YouTube Cookies Admin', { tag: '@slow' }, () => {
	test('can navigate to youtube-cookies page as admin', async ({ page, loginAsAdmin }) => {
		await loginAsAdmin()
		await page.goto('/admin/youtube-cookies')

		await expect(page.getByRole('heading', { name: /youtube cookies/i })).toBeVisible()
	})

	test('shows upload and paste sections', async ({ page, loginAsAdmin }) => {
		await loginAsAdmin()
		await page.goto('/admin/youtube-cookies')

		// Both sections should be visible
		await expect(page.getByRole('heading', { name: /upload cookie file/i })).toBeVisible()
		await expect(page.getByRole('heading', { name: /paste cookie content/i })).toBeVisible()

		// File input should be present
		await expect(page.getByLabel(/cookie file/i)).toBeVisible()

		// Textarea should be present
		await expect(page.getByLabel(/cookie content/i)).toBeVisible()
	})

	test('shows current state with no cookies', async ({ page, loginAsAdmin }) => {
		await loginAsAdmin()
		await page.goto('/admin/youtube-cookies')

		await expect(page.getByText(/cookies on disk/i)).toBeVisible()
		await expect(page.getByText(/no cookies uploaded yet/i)).toBeVisible()
	})

	test('can paste cookies via textarea', async ({ page, loginAsAdmin }) => {
		await loginAsAdmin()
		await page.goto('/admin/youtube-cookies')

		// Fill in the textarea with Netscape-format cookies
		const cookieText = `.youtube.com\tTRUE\t/\tTRUE\t1750000000\tLOGIN_INFO\taAbBcC==
.youtube.com\tTRUE\t/\tFALSE\t0\tPREF\tf1=50000000`

		const textarea = page.getByLabel(/cookie content/i)
		await textarea.fill(cookieText)

		// Click the import button
		await page.getByRole('button', { name: /import cookies/i }).click()

		// Should show success message
		await expect(page.getByText(/successfully imported/i)).toBeVisible({ timeout: 10000 })
	})

	test('can upload cookies via file input', async ({ page, loginAsAdmin }) => {
		await loginAsAdmin()
		await page.goto('/admin/youtube-cookies')

		// Set up file chooser
		const fileChooserPromise = page.waitForEvent('filechooser')
		await page.getByLabel(/cookie file/i).click()
		const fileChooser = await fileChooserPromise

		await fileChooser.setFiles({
			name: 'cookies.txt',
			mimeType: 'text/plain',
			buffer: Buffer.from('.youtube.com\tTRUE\t/\tTRUE\t1750000000\tSID\ttest123'),
		})

		// Click upload button
		await page.getByRole('button', { name: /upload & import/i }).click()

		// Should show success message
		await expect(page.getByText(/successfully imported/i)).toBeVisible({ timeout: 10000 })
	})

	test('shows error on invalid cookie content', async ({ page, loginAsAdmin }) => {
		await loginAsAdmin()
		await page.goto('/admin/youtube-cookies')

		// Fill with junk text that contains no valid cookies
		const textarea = page.getByLabel(/cookie content/i)
		await textarea.fill('this is not valid cookie content')

		// Click the import button
		await page.getByRole('button', { name: /import cookies/i }).click()

		// Should show 400 error boundary
		await expect(page.getByText(/no valid cookies|cannot be processed/i)).toBeVisible({ timeout: 10000 })
	})

	test('shows error on empty file upload', async ({ page, loginAsAdmin }) => {
		await loginAsAdmin()
		await page.goto('/admin/youtube-cookies')

		const fileChooserPromise = page.waitForEvent('filechooser')
		await page.getByLabel(/cookie file/i).click()
		const fileChooser = await fileChooserPromise

		await fileChooser.setFiles({
			name: 'empty.txt',
			mimeType: 'text/plain',
			buffer: Buffer.from(''),
		})

		await page.getByRole('button', { name: /upload & import/i }).click()

		// Should show error
		await expect(page.getByText(/empty|cannot be processed|no valid cookies/i)).toBeVisible({ timeout: 10000 })
	})

	test('non-admin users get 403', async ({ page, login }) => {
		await login()

		const response = await page.goto('/admin/youtube-cookies')
		expect(response?.status()).toBe(403)
	})

	test('shows last upload info after importing', async ({ page, loginAsAdmin }) => {
		await loginAsAdmin()
		await page.goto('/admin/youtube-cookies')

		// Paste cookies
		const cookieText = `.youtube.com\tTRUE\t/\tTRUE\t1800000000\tTEST\tvalue123`
		const textarea = page.getByLabel(/cookie content/i)
		await textarea.fill(cookieText)
		await page.getByRole('button', { name: /import cookies/i }).click()

		// Wait for success
		await expect(page.getByText(/successfully imported/i)).toBeVisible({ timeout: 10000 })

		// Navigate again to see last upload info
		await page.goto('/admin/youtube-cookies')
		await expect(page.getByText(/last upload/i)).toBeVisible({ timeout: 10000 })
	})

	test('paste area shows placeholder with example format', async ({ page, loginAsAdmin }) => {
		await loginAsAdmin()
		await page.goto('/admin/youtube-cookies')

		const textarea = page.getByLabel(/cookie content/i)
		const placeholder = await textarea.getAttribute('placeholder')
		expect(placeholder).toContain('Netscape HTTP Cookie File')
		expect(placeholder).toContain('LOGIN_INFO')
	})
})
