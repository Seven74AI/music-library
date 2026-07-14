import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockPrisma, mockSendEmail } = vi.hoisted(() => ({
	mockPrisma: {
		servicePlaylistTrack: {
			findFirst: vi.fn(),
		},
		servicePlaylist: {
			findMany: vi.fn(),
			updateMany: vi.fn(),
		},
		userNotification: {
			create: vi.fn(),
		},
		$transaction: vi.fn(),
	},
	mockSendEmail: vi.fn().mockResolvedValue({ status: 'success' }),
}))

vi.mock('#app/utils/db.server.ts', () => ({
	prisma: mockPrisma,
}))

vi.mock('#app/utils/email.server.ts', () => ({
	sendEmail: mockSendEmail,
}))

import {
	checkPlaylistArchiveReadyAfterTrackArchived,
	isServicePlaylistArchiveReady,
} from './playlist-archive-ready.server.tsx'

beforeEach(() => {
	vi.clearAllMocks()
	mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma))
})

describe('isServicePlaylistArchiveReady', () => {
	it('returns true when playlist has no active tracks (nothing to archive)', async () => {
		// findFirst returns null → no track without audio found → playlist IS ready
		mockPrisma.servicePlaylistTrack.findFirst.mockResolvedValue(null)

		await expect(isServicePlaylistArchiveReady('playlist-1')).resolves.toBe(true)
	})

	it('returns false when any active track lacks audio', async () => {
		// findFirst returns a match → at least one track has no audio → NOT ready
		mockPrisma.servicePlaylistTrack.findFirst.mockResolvedValue({ id: 'st-1' })

		await expect(isServicePlaylistArchiveReady('playlist-1')).resolves.toBe(false)
	})

	it('returns true when every active track has audio', async () => {
		// findFirst returns null → no track without audio found → playlist IS ready
		mockPrisma.servicePlaylistTrack.findFirst.mockResolvedValue(null)

		await expect(isServicePlaylistArchiveReady('playlist-1')).resolves.toBe(true)
	})
})

describe('checkPlaylistArchiveReadyAfterTrackArchived', () => {
	it('creates in-app notification and sends email when playlist becomes ready', async () => {
		mockPrisma.servicePlaylist.findMany.mockResolvedValue([
			{
				id: 'playlist-1',
				title: 'Chill Mix',
				ownerId: 'user-1',
				owner: {
					email: 'user@example.com',
					name: 'Alex',
					username: 'alex',
				},
			},
		])
		// findFirst returns null → playlist IS ready
		mockPrisma.servicePlaylistTrack.findFirst.mockResolvedValue(null)
		mockPrisma.userNotification.create.mockResolvedValue({ id: 'notif-1' })
		mockPrisma.servicePlaylist.updateMany.mockResolvedValue({ count: 1 })

		await checkPlaylistArchiveReadyAfterTrackArchived(
			'track-1',
			'https://music.example',
		)

		expect(mockPrisma.userNotification.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				userId: 'user-1',
				type: 'playlist_archive_ready',
				linkUrl: '/music/services/youtube/playlist/playlist-1',
			}),
		})
		expect(mockPrisma.servicePlaylist.updateMany).toHaveBeenCalledWith({
			where: { id: 'playlist-1', archiveReadyNotifiedAt: null },
			data: { archiveReadyNotifiedAt: expect.any(Date) },
		})
		expect(mockSendEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				to: 'user@example.com',
				subject: expect.stringContaining('Chill Mix'),
			}),
		)
	})

	it('does nothing when playlist is not fully archived yet', async () => {
		mockPrisma.servicePlaylist.findMany.mockResolvedValue([
			{
				id: 'playlist-1',
				title: 'Chill Mix',
				ownerId: 'user-1',
				owner: {
					email: 'user@example.com',
					name: 'Alex',
					username: 'alex',
				},
			},
		])
		// findFirst returns a match → NOT ready
		mockPrisma.servicePlaylistTrack.findFirst.mockResolvedValue({ id: 'st-1' })

		await checkPlaylistArchiveReadyAfterTrackArchived('track-1')

		expect(mockPrisma.userNotification.create).not.toHaveBeenCalled()
		expect(mockSendEmail).not.toHaveBeenCalled()
	})

	it('skips notification when another worker already claimed the playlist', async () => {
		mockPrisma.servicePlaylist.findMany.mockResolvedValue([
			{
				id: 'playlist-1',
				title: 'Chill Mix',
				ownerId: 'user-1',
				owner: {
					email: 'user@example.com',
					name: 'Alex',
					username: 'alex',
				},
			},
		])
		// findFirst returns null → playlist IS ready
		mockPrisma.servicePlaylistTrack.findFirst.mockResolvedValue(null)
		mockPrisma.servicePlaylist.updateMany.mockResolvedValue({ count: 0 })

		await checkPlaylistArchiveReadyAfterTrackArchived('track-1')

		expect(mockPrisma.userNotification.create).not.toHaveBeenCalled()
		expect(mockSendEmail).not.toHaveBeenCalled()
	})
})
