import { test as base, type Response } from '@playwright/test'
import { type User as UserModel } from '@prisma/client'
import { href, type Register } from 'react-router'
import * as setCookieParser from 'set-cookie-parser'
import {
	getPasswordHash,
	getSessionExpirationDate,
	sessionKey,
} from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { authSessionStorage } from '#app/utils/session.server.ts'
import { createUser } from './db-utils.ts'

export * from './db-utils.ts'

type GetOrInsertUserOptions = {
	id?: string
	username?: UserModel['username']
	password?: string
	email?: UserModel['email']
}

type User = {
	id: string
	email: string
	username: string
	name: string | null
}

async function getOrInsertUser({
	id,
	username,
	password,
	email,
}: GetOrInsertUserOptions = {}): Promise<User> {
	const select = { id: true, email: true, username: true, name: true }
	if (id) {
		return await prisma.user.findUniqueOrThrow({
			select,
			where: { id: id },
		})
	} else {
		const userData = createUser()
		username ??= userData.username
		password ??= userData.username
		email ??= userData.email
		return await prisma.user.create({
			select,
			data: {
				...userData,
				email,
				username,
				roles: { connect: { name: 'user' } },
				password: { create: { hash: await getPasswordHash(password) } },
			},
		})
	}
}

export type AppPages = keyof Register['pages']

/**
 * Helper function to clean up all user-related data in the correct order
 * to avoid foreign key constraint violations.
 * 
 * @param userIds - Array of user IDs to clean up
 * @returns Promise that resolves when cleanup is complete
 * 
 * @remarks
 * This function handles the complex foreign key relationships in the database:
 * - ServicePlaylist is automatically deleted due to CASCADE delete
 * - ServicePlaylistTrack is automatically deleted when ServicePlaylist is deleted (CASCADE)
 * - User-related data is deleted in parallel for better performance
 * - Roles are preserved as they are global entities shared across users
 * 
 * @example
 * ```typescript
 * await cleanupUserData(['user1', 'user2'])
 * ```
 */
async function cleanupUserData(userIds: string[]): Promise<void> {
	if (userIds.length === 0) return
	
	// Helper to create consistent where clauses
	const whereUserId = { userId: { in: userIds } }
	const whereOwnerId = { ownerId: { in: userIds } }
	const whereUserIds = { id: { in: userIds } }
	
	try {
		// Delete user tracks (references User)
		await prisma.userTrack.deleteMany({ where: whereUserId })
		
		// Delete user playlists and their tracks (references User)
		await prisma.userPlaylistTrack.deleteMany({
			where: {
				playlist: whereOwnerId
			}
		})
		await prisma.userPlaylist.deleteMany({ where: whereOwnerId })

		// Delete user-related data (references User) - can be done in parallel
		await Promise.all([
			prisma.session.deleteMany({ where: whereUserId }),
			prisma.connection.deleteMany({ where: whereUserId }),
			prisma.passkey.deleteMany({ where: whereUserId }),
			prisma.userImage.deleteMany({ where: whereUserId }),
			prisma.password.deleteMany({ where: whereUserId }),
		])
		
		// Finally delete the users (ServicePlaylist will be auto-deleted via CASCADE)
		await prisma.user.deleteMany({ where: whereUserIds })
	} catch (error) {
		console.warn(`Failed to cleanup users [${userIds.length} users]:`, error)
		// In test environment, we might want to re-throw to fail the test
		// but for now we'll just log to avoid breaking tests
	}
}

export const test = base.extend<{
	navigate: <Path extends AppPages>(
		...args: Parameters<typeof href<Path>>
	) => Promise<null | Response>
	insertNewUser(options?: GetOrInsertUserOptions): Promise<User>
	login(options?: GetOrInsertUserOptions): Promise<User>
	insertNewTrack(options?: { title?: string; artist?: string }, userId?: string): Promise<{ id: string; title: string; artist: string }>
	insertNewPlaylist(options?: {
		title?: string
		description?: string
		externalId?: string
		itemCount?: number
	}, userId?: string): Promise<{ id: string; title: string; externalId: string }>
}>({
	navigate: async ({ page }, use) => {
		await use((...args) => {
			return page.goto(href(...args))
		})
	},
	insertNewUser: async ({}, use) => {
		const userIds: string[] = []
		await use(async (options) => {
			const user = await getOrInsertUser(options)
			userIds.push(user.id)
			return user
		})
		// Use helper function for proper cleanup order
		await cleanupUserData(userIds)
	},
	login: async ({ page }, use) => {
		const userIds: string[] = []
		await use(async (options) => {
			const user = await getOrInsertUser(options)
			userIds.push(user.id)
			const session = await prisma.session.create({
				data: {
					expirationDate: getSessionExpirationDate(),
					userId: user.id,
				},
				select: { id: true },
			})

			const authSession = await authSessionStorage.getSession()
			authSession.set(sessionKey, session.id)
			const cookieConfig = setCookieParser.parseString(
				await authSessionStorage.commitSession(authSession),
			)
			const newConfig = {
				...cookieConfig,
				domain: 'localhost',
				expires: cookieConfig.expires?.getTime(),
				sameSite: cookieConfig.sameSite as 'Strict' | 'Lax' | 'None',
			}
			await page.context().addCookies([newConfig])
			return user
		})
		// Use helper function for proper cleanup order
		await cleanupUserData(userIds)
	},
	insertNewTrack: async ({}, use) => {
		const trackIds: string[] = []
		const userTrackIds: string[] = []
		await use(async (options?: { title?: string; artist?: string }, userId?: string) => {
			const track = await prisma.track.create({
				data: {
					title: options?.title || 'Test Track',
					artist: options?.artist || 'Test Artist',
				},
			})
			trackIds.push(track.id)
			
			// Add track to user's library if userId is provided
			if (userId) {
				const userTrack = await prisma.userTrack.create({
					data: {
						userId: userId,
						trackId: track.id,
					},
				})
				userTrackIds.push(userTrack.id)
			}
			
			return track
		})
		// Optimized cleanup - batch deletion
		if (userTrackIds.length > 0) {
			try {
				await prisma.userTrack.deleteMany({ where: { id: { in: userTrackIds } } })
			} catch (error) {
				console.warn(`Failed to cleanup user tracks:`, error)
			}
		}
		if (trackIds.length > 0) {
			try {
				await prisma.track.deleteMany({ where: { id: { in: trackIds } } })
			} catch (error) {
				console.warn(`Failed to cleanup tracks:`, error)
			}
		}
	},
	insertNewPlaylist: async ({}, use) => {
		const playlistIds: string[] = []
		await use(async (options, userId) => {
			// Use YOUTUBE_SERVICE_ID from config
			const { YOUTUBE_SERVICE_ID } = await import('#app/config/youtube')
			
			const playlist = await prisma.servicePlaylist.create({
				data: {
					serviceId: YOUTUBE_SERVICE_ID,
					externalId: options?.externalId || `PLtest${Date.now()}`,
					title: options?.title || 'Test Playlist',
					description: options?.description || 'Test description',
					channelId: 'test-channel-id',
					channelTitle: 'Test Channel',
					publishedAt: new Date(),
					itemCount: options?.itemCount || 0,
					ownerId: userId || 'test-user',
					isActive: true,
					lastSyncedAt: new Date(),
				},
			})
			playlistIds.push(playlist.id)
			return playlist
		})
		// Cleanup - ServicePlaylistTrack will CASCADE delete
		if (playlistIds.length > 0) {
			try {
				await prisma.servicePlaylist.deleteMany({ 
					where: { id: { in: playlistIds } } 
				})
			} catch (error) {
				console.warn(`Failed to cleanup playlists:`, error)
			}
		}
	},
})
export const { expect } = test

/**
 * This allows you to wait for something (like an email to be available).
 *
 * It calls the callback every 50ms until it returns a value (and does not throw
 * an error). After the timeout, it will throw the last error that was thrown or
 * throw the error message provided as a fallback
 */
export async function waitFor<ReturnValue>(
	cb: () => ReturnValue | Promise<ReturnValue>,
	{
		errorMessage,
		timeout = 5000,
	}: { errorMessage?: string; timeout?: number } = {},
) {
	const endTime = Date.now() + timeout
	let lastError: unknown = new Error(errorMessage)
	while (Date.now() < endTime) {
		try {
			const response = await cb()
			if (response) return response
		} catch (e: unknown) {
			lastError = e
		}
		await new Promise((r) => setTimeout(r, 100))
	}
	throw lastError
}
