import { prisma } from '#app/utils/db.server.ts'

/**
 * Worker status values matching the WorkerState model.
 */
export const WorkerStatus = {
	RUNNING: 'running',
	PAUSED: 'paused',
	LONG_BREAK: 'long_break',
} as const

export type WorkerStatus = (typeof WorkerStatus)[keyof typeof WorkerStatus]

/** Default duration for a long break in milliseconds (6 hours). */
export const LONG_BREAK_DURATION_MS = 6 * 60 * 60 * 1000

/**
 * WorkerState result shape.
 */
export interface WorkerStateResult {
	status: WorkerStatus
	lastQueueRun: Date | null
	nextLongBreakAt: Date | null
	lastStateChange: Date
}

// ── Private helpers ──────────────────────────────────────────────

/** Reshape a raw Prisma WorkerState into the public result shape. */
function reshape(state: {
	status: string
	lastQueueRun: Date | null
	nextLongBreakAt: Date | null
	lastStateChange: Date
}): WorkerStateResult {
	return {
		status: state.status as WorkerStatus,
		lastQueueRun: state.lastQueueRun,
		nextLongBreakAt: state.nextLongBreakAt,
		lastStateChange: state.lastStateChange,
	}
}

/**
 * Upsert the singleton WorkerState record with a new status and optional
 * extra fields.  Every mutation records `lastStateChange`.
 */
async function setWorkerState(
	status: WorkerStatus,
	extra: Record<string, unknown> = {},
): Promise<WorkerStateResult> {
	const state = await prisma.workerState.upsert({
		where: { id: 'singleton' },
		update: { status, lastStateChange: new Date(), ...extra },
		create: { id: 'singleton', status, ...extra },
	})
	return reshape(state)
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Get the current WorkerState, creating it (as "running") if it doesn't exist.
 */
export async function getWorkerState(): Promise<WorkerStateResult> {
	const existing = await prisma.workerState.findUnique({
		where: { id: 'singleton' },
	})
	if (existing) return reshape(existing)

	const state = await prisma.workerState.create({
		data: {
			id: 'singleton',
			status: WorkerStatus.RUNNING,
		},
	})
	return reshape(state)
}

/**
 * Check if the worker is currently allowed to process jobs.
 * Returns false if paused or on long_break (and break hasn't expired).
 */
export async function isWorkerActive(): Promise<boolean> {
	const state = await getWorkerState()

	if (state.status === WorkerStatus.PAUSED) return false

	if (state.status === WorkerStatus.LONG_BREAK) {
		// If the break has expired, auto-resume
		if (state.nextLongBreakAt && new Date() >= state.nextLongBreakAt) {
			await resumeWorker()
			return true
		}
		return false
	}

	return true
}

/**
 * Pause the worker. No new jobs will be picked up.
 * Running jobs are allowed to finish.
 */
export async function pauseWorker(): Promise<WorkerStateResult> {
	return setWorkerState(WorkerStatus.PAUSED)
}

/**
 * Resume the worker from paused or long_break state.
 */
export async function resumeWorker(): Promise<WorkerStateResult> {
	return setWorkerState(WorkerStatus.RUNNING, { nextLongBreakAt: null })
}

/**
 * Put the worker into a long break. It will auto-resume when
 * `nextLongBreakAt` is reached.
 *
 * @param durationMs Duration of the break in milliseconds. Default: 6 hours.
 */
export async function takeLongBreak(
	durationMs: number = LONG_BREAK_DURATION_MS,
): Promise<WorkerStateResult> {
	const nextLongBreakAt = new Date(Date.now() + durationMs)
	return setWorkerState(WorkerStatus.LONG_BREAK, { nextLongBreakAt })
}
