import { type FullTrack, type QueueTrack } from '#app/types/frontend/shared.ts'

export class AuthExpiredError extends Error {
	constructor() {
		super('Auth session expired')
		this.name = 'AuthExpiredError'
	}
}

export type QueueSpineContext =
	| { type: 'library' }
	| { type: 'playlist'; playlistId: string }

export type QueueSpineResponse = {
	tracks: QueueTrack[]
	total: number
}

export async function fetchQueueSpine(
	context: QueueSpineContext,
): Promise<QueueSpineResponse> {
	let url: string

	if (context.type === 'library') {
		url = '/api/queue-spine?context=library&hasAudio=1'
	} else {
		url = `/api/queue-spine?context=playlist&playlistId=${encodeURIComponent(context.playlistId)}`
	}

	const response = await fetch(url, { redirect: 'manual' })
	if (response.status >= 300 && response.status < 400) {
		throw new AuthExpiredError()
	}
	if (!response.ok) {
		throw new Error(`Failed to fetch queue spine: ${response.status}`)
	}

	return response.json() as Promise<QueueSpineResponse>
}

export function queueTrackFromFullTrack(track: FullTrack): QueueTrack {
	return {
		id: track.id,
		title: track.title,
		artist: track.artist,
	}
}

export function fullTrackStubFromQueueTrack(track: QueueTrack): FullTrack {
	return {
		id: track.id,
		title: track.title,
		artist: track.artist,
		duration: null,
		coverImage: null,
		audioFiles: [],
	}
}
