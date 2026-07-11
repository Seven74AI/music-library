import { describe, expect, it, vi, beforeEach } from 'vitest'

// Create a mock archiveJob object for the Prisma tx mock
const mockArchiveJob = {
	create: vi.fn(),
	createMany: vi.fn(),
	findMany: vi.fn(),
}

// Mock db.server — auto-enqueue doesn't import prisma directly,
// but other modules in the import chain may reference it
vi.mock('#app/utils/db.server.ts', () => ({
	prisma: {},
}))

const mockScheduleQueueTick = vi.fn()
vi.mock('./worker.server.ts', () => ({
	scheduleQueueTick: mockScheduleQueueTick,
}))

describe('enqueueArchiveJob', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe('job creation', () => {
		it('creates ArchiveJob with pending status and auto-priority', async () => {
			const { enqueueArchiveJob } = await import('./auto-enqueue.server.ts')

			mockArchiveJob.create.mockResolvedValue({ id: 'job-1', trackId: 'track-1' })

			const tx = { archiveJob: mockArchiveJob }
			await enqueueArchiveJob(tx as any, 'track-1')

			expect(mockArchiveJob.create).toHaveBeenCalledTimes(1)
			const callArgs = mockArchiveJob.create.mock.calls[0]![0]
			expect(callArgs.data.trackId).toBe('track-1')
			expect(callArgs.data.status).toBe('pending')
			expect(callArgs.data.priority).toBe(false)
			expect(mockScheduleQueueTick).toHaveBeenCalledTimes(1)
		})

		it('silently skips when ArchiveJob already exists (unique constraint)', async () => {
			const { enqueueArchiveJob } = await import('./auto-enqueue.server.ts')

			// Simulate unique constraint violation
			mockArchiveJob.create.mockRejectedValue(
				new Error('Unique constraint failed on the fields: (`trackId`)'),
			)

			const tx = { archiveJob: mockArchiveJob }
			// Should not throw
			await expect(enqueueArchiveJob(tx as any, 'track-1')).resolves.toBeUndefined()

			expect(mockArchiveJob.create).toHaveBeenCalledTimes(1)
			expect(mockScheduleQueueTick).not.toHaveBeenCalled()
		})

		it('does not throw on any database error', async () => {
			const { enqueueArchiveJob } = await import('./auto-enqueue.server.ts')

			mockArchiveJob.create.mockRejectedValue(new Error('Database connection lost'))

			const tx = { archiveJob: mockArchiveJob }
			// Should not throw — errors are caught silently
			await expect(enqueueArchiveJob(tx as any, 'track-1')).resolves.toBeUndefined()
			expect(mockScheduleQueueTick).not.toHaveBeenCalled()
		})
	})
})

describe('enqueueArchiveJobs (batch)', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('creates jobs only for tracks without existing jobs, in one createMany', async () => {
		const { enqueueArchiveJobs } = await import('./auto-enqueue.server.ts')

		// track-2 already has a job
		mockArchiveJob.findMany.mockResolvedValue([{ trackId: 'track-2' }])
		mockArchiveJob.createMany.mockResolvedValue({ count: 2 })

		const tx = { archiveJob: mockArchiveJob }
		await enqueueArchiveJobs(tx as any, ['track-1', 'track-2', 'track-3'])

		expect(mockArchiveJob.findMany).toHaveBeenCalledTimes(1)
		expect(mockArchiveJob.findMany).toHaveBeenCalledWith({
			where: { trackId: { in: ['track-1', 'track-2', 'track-3'] } },
			select: { trackId: true },
		})
		expect(mockArchiveJob.createMany).toHaveBeenCalledTimes(1)
		expect(mockArchiveJob.createMany).toHaveBeenCalledWith({
			data: [
				{ trackId: 'track-1', status: 'pending', priority: false },
				{ trackId: 'track-3', status: 'pending', priority: false },
			],
		})
		expect(mockScheduleQueueTick).toHaveBeenCalledTimes(1)
	})

	it('skips createMany and queue tick when all tracks already have jobs', async () => {
		const { enqueueArchiveJobs } = await import('./auto-enqueue.server.ts')

		mockArchiveJob.findMany.mockResolvedValue([
			{ trackId: 'track-1' },
			{ trackId: 'track-2' },
		])

		const tx = { archiveJob: mockArchiveJob }
		await enqueueArchiveJobs(tx as any, ['track-1', 'track-2'])

		expect(mockArchiveJob.createMany).not.toHaveBeenCalled()
		expect(mockScheduleQueueTick).not.toHaveBeenCalled()
	})

	it('does nothing for empty trackIds', async () => {
		const { enqueueArchiveJobs } = await import('./auto-enqueue.server.ts')

		const tx = { archiveJob: mockArchiveJob }
		await enqueueArchiveJobs(tx as any, [])

		expect(mockArchiveJob.findMany).not.toHaveBeenCalled()
		expect(mockArchiveJob.createMany).not.toHaveBeenCalled()
		expect(mockScheduleQueueTick).not.toHaveBeenCalled()
	})

	it('deduplicates trackIds before querying', async () => {
		const { enqueueArchiveJobs } = await import('./auto-enqueue.server.ts')

		mockArchiveJob.findMany.mockResolvedValue([])
		mockArchiveJob.createMany.mockResolvedValue({ count: 1 })

		const tx = { archiveJob: mockArchiveJob }
		await enqueueArchiveJobs(tx as any, ['track-1', 'track-1'])

		expect(mockArchiveJob.createMany).toHaveBeenCalledWith({
			data: [{ trackId: 'track-1', status: 'pending', priority: false }],
		})
	})

	it('does not throw on database error', async () => {
		const { enqueueArchiveJobs } = await import('./auto-enqueue.server.ts')

		mockArchiveJob.findMany.mockRejectedValue(new Error('Database connection lost'))

		const tx = { archiveJob: mockArchiveJob }
		await expect(
			enqueueArchiveJobs(tx as any, ['track-1']),
		).resolves.toBeUndefined()
		expect(mockScheduleQueueTick).not.toHaveBeenCalled()
	})
})
