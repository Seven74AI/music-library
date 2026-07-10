/**
 * @vitest-environment jsdom
 *
 * Unit tests for the audio-queue admin page.
 * Pattern follows youtube-cookies.test.tsx.
 */
import { render, screen } from '@testing-library/react'
import { createRoutesStub } from 'react-router'
import setCookieParser from 'set-cookie-parser'
import { test, expect } from 'vitest'
import { loader as rootLoader } from '#app/root.tsx'
import { getSessionExpirationDate, sessionKey } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { authSessionStorage } from '#app/utils/session.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { consoleError } from '#tests/setup/setup-test-env.ts'
import { default as AudioQueueRoute, loader, ErrorBoundary } from './audio-queue.tsx'

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
	const parsedCookie = setCookieParser.parseString(setCookieHeader)
	return new URLSearchParams({
		[parsedCookie.name]: parsedCookie.value,
	}).toString()
}

test('The audio-queue admin page renders all three sections', async () => {
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
					path: 'admin/audio-queue',
					Component: AudioQueueRoute,
					ErrorBoundary,
					loader: async (args) => {
						args.request.headers.set('cookie', cookieHeader)
						return loader({ ...args, context: args.context })
					},
				},
			],
		},
	])

	render(<App initialEntries={['/admin/audio-queue']} />)

	await screen.findByRole(
		'heading',
		{ level: 1, name: /audio archive queue/i },
		{ timeout: 5000 },
	)
	await screen.findByRole(
		'heading',
		{ level: 2, name: /worker control/i },
		{ timeout: 5000 },
	)
	await screen.findByRole(
		'heading',
		{ level: 2, name: /track queue/i },
		{ timeout: 5000 },
	)
})

test('The audio-queue admin page shows queue statistics', async () => {
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
					path: 'admin/audio-queue',
					Component: AudioQueueRoute,
					ErrorBoundary,
					loader: async (args) => {
						args.request.headers.set('cookie', cookieHeader)
						return loader({ ...args, context: args.context })
					},
				},
			],
		},
	])

	render(<App initialEntries={['/admin/audio-queue']} />)

	// Stats cards should be visible. Some labels (Pending, Processing, etc.)
	// also appear as filter buttons, so use getAllByText and check count >= 1.
	await screen.findByText(/success rate/i, {}, { timeout: 5000 })
	expect(screen.getAllByText(/pending/i).length).toBeGreaterThanOrEqual(1)
	expect(screen.getAllByText(/processing/i).length).toBeGreaterThanOrEqual(1)
	expect(screen.getAllByText(/completed/i).length).toBeGreaterThanOrEqual(1)
	expect(screen.getAllByText(/failed/i).length).toBeGreaterThanOrEqual(1)
	expect(screen.getAllByText(/total/i).length).toBeGreaterThanOrEqual(1)
})

test('The audio-queue admin page shows worker status', async () => {
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
					path: 'admin/audio-queue',
					Component: AudioQueueRoute,
					ErrorBoundary,
					loader: async (args) => {
						args.request.headers.set('cookie', cookieHeader)
						return loader({ ...args, context: args.context })
					},
				},
			],
		},
	])

	render(<App initialEntries={['/admin/audio-queue']} />)

	await screen.findByText(/running/i, {}, { timeout: 5000 })
	await screen.findByText(/currently processing/i, {}, { timeout: 5000 })
	await screen.findByText(/last queue run/i, {}, { timeout: 5000 })
	await screen.findByText(/last state change/i, {}, { timeout: 5000 })
})

test('The audio-queue admin page has filter buttons', async () => {
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
					path: 'admin/audio-queue',
					Component: AudioQueueRoute,
					ErrorBoundary,
					loader: async (args) => {
						args.request.headers.set('cookie', cookieHeader)
						return loader({ ...args, context: args.context })
					},
				},
			],
		},
	])

	render(<App initialEntries={['/admin/audio-queue']} />)

	const buttons = await screen.findAllByRole('button', {}, { timeout: 5000 })
	const buttonTexts = buttons.map(b => b.textContent?.trim())
	expect(buttonTexts.some(t => t?.toLowerCase() === 'all')).toBeTruthy()
	expect(buttonTexts.some(t => t?.toLowerCase() === 'pending')).toBeTruthy()
	expect(buttonTexts.some(t => t?.toLowerCase() === 'processing')).toBeTruthy()
	expect(buttonTexts.some(t => t?.toLowerCase() === 'completed')).toBeTruthy()
	expect(buttonTexts.some(t => t?.toLowerCase() === 'failed')).toBeTruthy()
})

test('Non-admin users get 403 error', async () => {
	// Suppress console.error for expected 403 error
	consoleError.mockImplementation(() => {})

	const user = await prisma.user.create({
		select: { id: true, username: true, name: true },
		data: createUser(),
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
	const parsedCookie = setCookieParser.parseString(setCookieHeader)
	const cookieHeader = new URLSearchParams({
		[parsedCookie.name]: parsedCookie.value,
	}).toString()

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
					path: 'admin/audio-queue',
					Component: AudioQueueRoute,
					ErrorBoundary,
					loader: async (args) => {
						args.request.headers.set('cookie', cookieHeader)
						return loader({ ...args, context: args.context })
					},
				},
			],
		},
	])

	render(<App initialEntries={['/admin/audio-queue']} />)

	await screen.findByText(/you must be an admin/i, {}, { timeout: 5000 })
})
