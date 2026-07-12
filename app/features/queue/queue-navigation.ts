import { type QueueTrack } from '#app/types/frontend/shared.ts'

export type LoopMode = 'off' | 'all' | 'one'

export type QueueZone = 'upNext' | 'spine'

export type QueueTarget = {
	zone: QueueZone
	index: number
}

export type QueueNavigationState = {
	upNext: QueueTrack[]
	spine: QueueTrack[]
	/** Permutation of spine indices defining play order. */
	spineOrder: number[]
	/** Current position within spineOrder (not raw spine index). */
	spinePosition: number
	loopMode: LoopMode
}

export function getSpinePlayOrder(state: QueueNavigationState): QueueTrack[] {
	const { spine, spineOrder, spinePosition } = state
	return spineOrder.slice(spinePosition).map(index => spine[index]!)
}

export function resolveNextTrack(
	state: QueueNavigationState,
): QueueTarget | null {
	if (state.loopMode === 'one') {
		return { zone: 'spine', index: state.spinePosition }
	}

	if (state.upNext.length > 0) {
		return { zone: 'upNext', index: 0 }
	}

	const nextSpinePosition = state.spinePosition + 1
	if (nextSpinePosition < state.spineOrder.length) {
		return { zone: 'spine', index: nextSpinePosition }
	}

	if (state.loopMode === 'all' && state.spineOrder.length > 0) {
		return { zone: 'spine', index: 0 }
	}

	return null
}

export function resolvePreviousTrack(
	state: QueueNavigationState,
): QueueTarget | null {
	if (state.loopMode === 'one') {
		return { zone: 'spine', index: state.spinePosition }
	}

	const previousSpinePosition = state.spinePosition - 1
	if (previousSpinePosition >= 0) {
		return { zone: 'spine', index: previousSpinePosition }
	}

	if (state.loopMode === 'all' && state.spineOrder.length > 0) {
		return { zone: 'spine', index: state.spineOrder.length - 1 }
	}

	return null
}

export function hasNextTrack(state: QueueNavigationState): boolean {
	return resolveNextTrack(state) !== null
}

export function hasPreviousTrack(state: QueueNavigationState): boolean {
	return resolvePreviousTrack(state) !== null
}

export function advanceAfterPlay(
	state: QueueNavigationState,
	played: QueueTarget,
): QueueNavigationState {
	if (played.zone === 'upNext') {
		return {
			...state,
			upNext: state.upNext.filter((_, index) => index !== played.index),
		}
	}

	return {
		...state,
		spinePosition: played.index,
	}
}

export function getTrackAtTarget(
	state: QueueNavigationState,
	target: QueueTarget,
): QueueTrack | null {
	if (target.zone === 'upNext') {
		return state.upNext[target.index] ?? null
	}

	const spineIndex = state.spineOrder[target.index]
	if (spineIndex === undefined) return null
	return state.spine[spineIndex] ?? null
}

export function findSpinePositionForTrackId(
	state: QueueNavigationState,
	trackId: string,
): number | null {
	const position = state.spineOrder.findIndex(
		spineIndex => state.spine[spineIndex]?.id === trackId,
	)
	return position >= 0 ? position : null
}

export function buildFlatQueueView(state: QueueNavigationState): QueueTrack[] {
	return [...state.upNext, ...getSpinePlayOrder(state)]
}

export function flatIndexForSpinePosition(
	state: QueueNavigationState,
	spinePosition: number,
): number {
	return state.upNext.length + Math.max(0, spinePosition - state.spinePosition)
}
