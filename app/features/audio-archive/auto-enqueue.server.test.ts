import { describe, expect, it, vi, beforeEach } from 'vitest'

// Create a mock archiveJob object for the Prisma tx mock
const mockArchiveJob = {
	create: vi.fn(),
}

// Mock db.server — auto-enqueue doesn't import prisma directly,
// but other modules in the import chain may reference it
vi.mock('#app/utils/db.server.ts', () => ({
	prisma: {},
}))

describe('enqueueArchiveJob', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe('AUDIO_ARCHIVE_ENABLED check', () => {
		it('skips enqueue when AUDIO_ARCHIVE_ENABLED is not true', async () => {
			process.env.AUDIO_ARCHIVE_ENABLED = 'false'
			const { enqueueArchiveJob } = await import('./auto-enqueue.server.ts')

			const tx = { archiveJob: mockArchiveJob }
			await enqueueArchiveJob(tx as any, 'track-1')

			expect(mockArchiveJob.create).not.toHaveBeenCalled()
		})

		it('skips enqueue when AUDIO_ARCHIVE_ENABLED is empty', async () => {
			process.env.AUDIO_ARCHIVE_ENABLED = ''
			const { enqueueArchiveJob } = await import('./auto-enqueue.server.ts')

			const tx = { archiveJob: mockArchiveJob }
			await enqueueArchiveJob(tx as any, 'track-1')

			expect(mockArchiveJob.create).not.toHaveBeenCalled()
		})

		it('proceeds when AUDIO_ARCHIVE_ENABLED is true', async () => {
			process.env.AUDIO_ARCHIVE_ENABLED = 'true'
			const { enqueueArchiveJob } = await import('./auto-enqueue.server.ts')

			mockArchiveJob.create.mockResolvedValue({ id: 'job-1', trackId: 'track-1' })

			const tx = { archiveJob: mockArchiveJob }
			await enqueueArchiveJob(tx as any, 'track-1')

			expect(mockArchiveJob.create).toHaveBeenCalledWith({
				data: {
					trackId: 'track-1',
					status: 'pending',
					priority: false,
				},
			})
		})
	})

	describe('job creation', () => {
		it('creates ArchiveJob with pending status and auto-priority', async () => {
			process.env.AUDIO_ARCHIVE_ENABLED = 'true'
			const { enqueueArchiveJob } = await import('./auto-enqueue.server.ts')

			mockArchiveJob.create.mockResolvedValue({ id: 'job-1', trackId: 'track-1' })

			const tx = { archiveJob: mockArchiveJob }
			await enqueueArchiveJob(tx as any, 'track-1')

			expect(mockArchiveJob.create).toHaveBeenCalledTimes(1)
			const callArgs = mockArchiveJob.create.mock.calls[0][0]
			expect(callArgs.data.trackId).toBe('track-1')
			expect(callArgs.data.status).toBe('pending')
			expect(callArgs.data.priority).toBe(false)
		})

		it('silently skips when ArchiveJob already exists (unique constraint)', async () => {
			process.env.AUDIO_ARCHIVE_ENABLED = 'true'
			const { enqueueArchiveJob } = await import('./auto-enqueue.server.ts')

			// Simulate unique constraint violation
			mockArchiveJob.create.mockRejectedValue(
				new Error('Unique constraint failed on the fields: (`trackId`)'),
			)

			const tx = { archiveJob: mockArchiveJob }
			// Should not throw
			await expect(enqueueArchiveJob(tx as any, 'track-1')).resolves.toBeUndefined()

			expect(mockArchiveJob.create).toHaveBeenCalledTimes(1)
		})

		it('does not throw on any database error', async () => {
			process.env.AUDIO_ARCHIVE_ENABLED = 'true'
			const { enqueueArchiveJob } = await import('./auto-enqueue.server.ts')

			mockArchiveJob.create.mockRejectedValue(new Error('Database connection lost'))

			const tx = { archiveJob: mockArchiveJob }
			// Should not throw — errors are caught silently
			await expect(enqueueArchiveJob(tx as any, 'track-1')).resolves.toBeUndefined()
		})
	})
})
