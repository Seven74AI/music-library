import { invariant } from '@epic-web/invariant'
import { faker } from '@faker-js/faker'
import { verifyUserPassword } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { readEmail } from '#tests/mocks/utils.ts'
import { expect, test, createUser, waitFor } from '#tests/playwright-utils.ts'

const CODE_REGEX = /Here's your verification code: (?<code>[\d\w]+)/

test('Users can update their basic info', { tag: '@smoke' }, async ({ page, navigate, login }) => {
	await login()
	await navigate('/settings/profile')

	const newUserData = createUser()

	await page.getByRole('textbox', { name: /^name/i }).fill(newUserData.name)
	await page
		.getByRole('textbox', { name: /^username/i })
		.fill(newUserData.username)

	await page.getByRole('button', { name: /^save/i }).click()
})

test('Users can update their password', async ({ page, navigate, login }) => {
	const oldPassword = faker.internet.password()
	const newPassword = faker.internet.password()
	const user = await login({ password: oldPassword })
	await navigate('/settings/profile')

	await page.getByRole('link', { name: /change password/i }).click()

	await page
		.getByRole('textbox', { name: /^current password/i })
		.fill(oldPassword)
	await page.getByRole('textbox', { name: /^new password/i }).fill(newPassword)
	await page
		.getByRole('textbox', { name: /^confirm new password/i })
		.fill(newPassword)

	await page.getByRole('button', { name: /^change password/i }).click()

	await expect(page).toHaveURL(`/settings/profile`)

	const { username } = user
	expect(
		await verifyUserPassword({ username }, oldPassword),
		'Old password still works',
	).toBeNull()
	expect(
		await verifyUserPassword({ username }, newPassword),
		'New password does not work',
	).toEqual({ id: user.id })
})

test('Users can update their profile photo', { tag: '@slow' }, async ({
	page,
	navigate,
	login,
}) => {
	const user = await login()
	await navigate('/settings/profile')

	const beforeSrc = await page
		.getByRole('main')
		.getByRole('img', { name: user.name ?? user.username })
		.getAttribute('src')

	await page.getByRole('link', { name: /change profile photo/i }).click()

	await expect(page).toHaveURL(`/settings/profile/photo`)

	// The file input is hidden, so we need to use a different approach
	// eslint-disable-next-line playwright/no-raw-locators
	await page.locator('input[type="file"]').setInputFiles('./tests/fixtures/images/user/kody.png')

	// Wait for the file to be selected and the form to be ready
	await page.waitForTimeout(1000)

	// Check if the save button is visible and enabled
	const saveButton = page.getByRole('button', { name: /save/i })
	await expect(saveButton).toBeVisible()
	await expect(saveButton).toBeEnabled()

	// Listen for form submission - the form redirects to /settings/profile after successful upload
	const formSubmissionPromise = page.waitForURL('**/settings/profile', { timeout: 10000 })

	await saveButton.click()

	// Wait for the form submission to complete and redirect
	try {
		await formSubmissionPromise
		console.log('Form submission completed and redirected')
	} catch (error) {
		console.error('Form submission failed or timed out:', error)
		throw error
	}

	await expect(
		page,
		'Was not redirected after saving the profile photo',
	).toHaveURL(`/settings/profile`)

	const afterSrc = await page
		.getByRole('main')
		.getByRole('img', { name: user.name ?? user.username })
		.getAttribute('src')

	// not sure how to get the before/after src with getAttribute inline
	// eslint-disable-next-line playwright/prefer-web-first-assertions
	expect(beforeSrc).not.toEqual(afterSrc)
})

test('Users can change their email address', { tag: '@slow' }, async ({
	page,
	navigate,
	login,
}) => {
	const preUpdateUser = await login()
	const newEmailAddress = faker.internet.email().toLowerCase()
	expect(preUpdateUser.email).not.toEqual(newEmailAddress)
	await navigate('/settings/profile')
	await page.getByRole('link', { name: /change email/i }).click()
	await page.getByRole('textbox', { name: /new email/i }).fill(newEmailAddress)
	await page.getByRole('button', { name: /send confirmation/i }).click()
	await expect(page.getByText(/check your email/i)).toBeVisible()
	const email = await waitFor(() => readEmail(newEmailAddress), {
		errorMessage: 'Confirmation email was not sent',
	})
	invariant(email, 'Email was not sent')
	const codeMatch = email.text.match(CODE_REGEX)
	const code = codeMatch?.groups?.code
	invariant(code, 'Onboarding code not found')
	await page.getByRole('textbox', { name: /code/i }).fill(code)
	await page.getByRole('button', { name: /submit/i }).click()
	await expect(page.getByText('Email Changed', { exact: true })).toBeVisible()

	const updatedUser = await prisma.user.findUnique({
		where: { id: preUpdateUser.id },
		select: { email: true },
	})
	invariant(updatedUser, 'Updated user not found')
	expect(updatedUser.email).toBe(newEmailAddress)
	const noticeEmail = await waitFor(() => readEmail(preUpdateUser.email), {
		errorMessage: 'Notice email was not sent',
	})
	expect(noticeEmail.subject).toContain('changed')
})
