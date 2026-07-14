import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock the prisma import — state is held in module-scoped vars
let _mockStatus = 'running'
let _mockNextLongBreakAt: Date | null = null
let _mockLastQueueRun: Date | null = null
let _mockCreated = false

vi.mock('#app/utils/db.server.ts', () => {
	function getState() {
		return {
			id: 'singleton',
			status: _mockStatus,
			lastQueueRun: _mockLastQueueRun,
			nextLongBreakAt: _mockNextLongBreakAt,
			lastStateChange: new Date(),
		}
	}

	return {
		prisma: {
			$disconnect: vi.fn().mockResolvedValue(undefined),
			workerState: {
				upsert: vi.fn().mockImplementation(async (args: any) => {
					if (!_mockCreated) {
						// First call: simulate creation
						if (args.create) {
							_mockStatus = args.create.status ?? 'running'
							_mockNextLongBreakAt = args.create.nextLongBreakAt ?? null
							_mockLastQueueRun = args.create.lastQueueRun ?? null
						}
						_mockCreated = true
					}
					// Apply update only if it has meaningful keys (non-empty)
					const upd = args.update
					if (upd && Object.keys(upd).length > 0) {
						if ('status' in upd) _mockStatus = upd.status
						if ('lastQueueRun' in upd) _mockLastQueueRun = upd.lastQueueRun
						if ('nextLongBreakAt' in upd) _mockNextLongBreakAt = upd.nextLongBreakAt
					}
					return getState()
				}),
				findUnique: vi.fn().mockImplementation(async () => {
					return _mockCreated ? getState() : null
				}),
				create: vi.fn().mockImplementation(async (args: any) => {
					_mockStatus = args.data.status ?? 'running'
					_mockNextLongBreakAt = args.data.nextLongBreakAt ?? null
					_mockLastQueueRun = args.data.lastQueueRun ?? null
					_mockCreated = true
					return getState()
				}),
			},
		},
	}
})

describe('worker-control', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		_mockStatus = 'running'
		_mockLastQueueRun = null
		_mockNextLongBreakAt = null
		_mockCreated = false
	})

	describe('getWorkerState', () => {
		it('returns running status by default', async () => {
			const { getWorkerState } = await import('./worker-control.server.ts')
			const state = await getWorkerState()
			expect(state.status).toBe('running')
		})

		it('returns paused status when paused', async () => {
			_mockStatus = 'paused'
			_mockCreated = true // skip creation
			const { getWorkerState } = await import('./worker-control.server.ts')
			const state = await getWorkerState()
			expect(state.status).toBe('paused')
		})
	})

	describe('pauseWorker', () => {
		it('sets status to paused', async () => {
			_mockCreated = true // skip creation, use existing state
			const { pauseWorker } = await import('./worker-control.server.ts')
			const state = await pauseWorker()
			expect(state.status).toBe('paused')
		})
	})

	describe('resumeWorker', () => {
		it('sets status to running and clears nextLongBreakAt', async () => {
			_mockStatus = 'paused'
			_mockNextLongBreakAt = new Date('2099-01-01')
			_mockCreated = true
			const { resumeWorker } = await import('./worker-control.server.ts')
			const state = await resumeWorker()
			expect(state.status).toBe('running')
			expect(state.nextLongBreakAt).toBeNull()
		})
	})

	describe('takeLongBreak', () => {
		it('sets status to long_break and nextLongBreakAt in the future', async () => {
			_mockCreated = true
			const { takeLongBreak } = await import('./worker-control.server.ts')
			const before = Date.now()
			const state = await takeLongBreak()
			expect(state.status).toBe('long_break')
			expect(state.nextLongBreakAt).toBeInstanceOf(Date)
			expect(state.nextLongBreakAt!.getTime()).toBeGreaterThan(before)
		})

		it('accepts a custom duration', async () => {
			_mockCreated = true
			const { takeLongBreak } = await import('./worker-control.server.ts')
			const before = Date.now()
			const state = await takeLongBreak(60000) // 1 minute
			expect(state.nextLongBreakAt!.getTime()).toBeGreaterThan(before)
			expect(state.nextLongBreakAt!.getTime()).toBeLessThanOrEqual(before + 70000)
		})
	})

	describe('isWorkerActive', () => {
		it('returns true when running', async () => {
			_mockCreated = true
			const { isWorkerActive } = await import('./worker-control.server.ts')
			expect(await isWorkerActive()).toBe(true)
		})

		it('returns false when paused', async () => {
			_mockStatus = 'paused'
			_mockCreated = true
			const { isWorkerActive } = await import('./worker-control.server.ts')
			expect(await isWorkerActive()).toBe(false)
		})

		it('returns false when on long_break not expired', async () => {
			_mockStatus = 'long_break'
			_mockNextLongBreakAt = new Date(Date.now() + 3600000)
			_mockCreated = true
			const { isWorkerActive } = await import('./worker-control.server.ts')
			expect(await isWorkerActive()).toBe(false)
		})

		it('auto-resumes when long_break has expired', async () => {
			_mockStatus = 'long_break'
			_mockNextLongBreakAt = new Date(Date.now() - 1000)
			_mockCreated = true
			const { isWorkerActive } = await import('./worker-control.server.ts')
			expect(await isWorkerActive()).toBe(true)
			expect(_mockStatus).toBe('running')
		})
	})
})
