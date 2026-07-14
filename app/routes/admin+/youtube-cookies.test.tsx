/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { createRoutesStub } from 'react-router'
import { parseString } from 'set-cookie-parser'
import { test, expect } from 'vitest'
import { loader as rootLoader } from '#app/root.tsx'
import { getSessionExpirationDate, sessionKey } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { authSessionStorage } from '#app/utils/session.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { default as YoutubeCookiesRoute, loader } from './youtube-cookies.tsx'

// Helper to create an admin session for testing
async function createAdminSession() {
	const user = await prisma.user.create({
		select: { id: true, username: true, name: true },
		data: {
			...createUser(),
			roles: {
				connectOrCreate: {
					where: { name: 'admin' },
					create: { name: 'admin' },
				},
			},
		},
	})
	const session = await prisma.session.create({
		select: { id: true },
		data: {
			expirationDate: getSessionExpirationDate(),
			userId: user.id,
		},
	})

	const authSession = await authSessionStorage.getSession()
	authSession.set(sessionKey, session.id)
	const setCookieHeader = await authSessionStorage.commitSession(authSession)
	const parsedCookie = parseString(setCookieHeader)!
	return new URLSearchParams({
		[parsedCookie.name]: parsedCookie.value,
	}).toString()
}

// Test the basic rendered structure in jsdom.
// Complex interactions (file upload, form submission) are covered by E2E tests.

test('The youtube-cookies admin page renders both upload and paste sections', async () => {
	const cookieHeader = await createAdminSession()

	const App = createRoutesStub([
		{
			id: 'root',
			path: '/',
			loader: async (args) => {
				args.request.headers.set('cookie', cookieHeader)
				return rootLoader({ ...args, context: args.context })
			},
			HydrateFallback: () => <div>Loading...</div>,
			children: [
				{
					path: 'admin/youtube-cookies',
					Component: YoutubeCookiesRoute,
					loader: async (args) => {
						args.request.headers.set('cookie', cookieHeader)
						return loader({ ...args, context: args.context })
					},
				},
			],
		},
	])

	render(<App initialEntries={['/admin/youtube-cookies']} />)

	// Header should be visible
	await screen.findByRole('heading', { level: 1, name: /youtube cookies/i }, { timeout: 5000 })

	// Both sections should be visible
	await screen.findByRole('heading', { level: 2, name: /upload cookie file/i }, { timeout: 5000 })
	await screen.findByRole('heading', { level: 2, name: /paste cookie content/i }, { timeout: 5000 })

	// Current state section
	await screen.findByRole('heading', { level: 2, name: /current state/i }, { timeout: 5000 })
	expect(screen.getByText(/cookies on disk/i)).toBeTruthy()
})

test('The youtube-cookies admin page shows file input for upload', async () => {
	const cookieHeader = await createAdminSession()

	const App = createRoutesStub([
		{
			id: 'root',
			path: '/',
			loader: async (args) => {
				args.request.headers.set('cookie', cookieHeader)
				return rootLoader({ ...args, context: args.context })
			},
			HydrateFallback: () => <div>Loading...</div>,
			children: [
				{
					path: 'admin/youtube-cookies',
					Component: YoutubeCookiesRoute,
					loader: async (args) => {
						args.request.headers.set('cookie', cookieHeader)
						return loader({ ...args, context: args.context })
					},
				},
			],
		},
	])

	render(<App initialEntries={['/admin/youtube-cookies']} />)

	// The file input should be present
	const fileInput = await screen.findByLabelText(/cookie file/i, {}, { timeout: 5000 })
	expect(fileInput).toBeTruthy()
	expect(fileInput.getAttribute('type')).toBe('file')
	expect(fileInput.getAttribute('accept')).toBe('.txt')

	// The textarea should be present
	const textarea = await screen.findByLabelText(/cookie content/i, {}, { timeout: 5000 })
	expect(textarea).toBeTruthy()

	// Both submit buttons should be present
	const buttons = screen.getAllByRole('button')
	expect(buttons.some(b => b.textContent?.includes('Upload'))).toBeTruthy()
	expect(buttons.some(b => b.textContent?.includes('Import'))).toBeTruthy()
})
