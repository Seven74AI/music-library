import { type QueueTrack } from '#app/types/frontend/shared.ts'
import { prisma } from '#app/utils/db.server.ts'
import { buildLibraryUserTracksWhere } from '#app/utils/library-user-tracks.server.ts'

export const QUEUE_TRACK_SELECT = {
	id: true,
	title: true,
	artist: {
		select: {
			id: true,
			name: true,
		},
	},
} as const

type LibrarySpineParams = {
	context: 'library'
	hasAudioOnly: true
}

type PlaylistSpineParams = {
	context: 'playlist'
	playlistId: string
}

export type QueueSpineParams = LibrarySpineParams | PlaylistSpineParams

type ParseResult =
	| { ok: true; value: QueueSpineParams }
	| { ok: false; error: string }

export function parseQueueSpineParams(
	searchParams: URLSearchParams,
): ParseResult {
	const context = searchParams.get('context')

	if (context === 'library') {
		if (searchParams.get('hasAudio') !== '1') {
			return { ok: false, error: 'Invalid hasAudio parameter' }
		}

		return {
			ok: true,
			value: { context: 'library', hasAudioOnly: true },
		}
	}

	if (context === 'playlist') {
		const playlistId = searchParams.get('playlistId')
		if (!playlistId) {
			return { ok: false, error: 'Playlist ID is required' }
		}

		return {
			ok: true,
			value: { context: 'playlist', playlistId },
		}
	}

	return { ok: false, error: 'Invalid context parameter' }
}

export async function fetchQueueSpine(
	userId: string,
	params: QueueSpineParams,
): Promise<{ tracks: QueueTrack[]; total: number }> {
	if (params.context === 'library') {
		const userTracks = await prisma.userTrack.findMany({
			where: buildLibraryUserTracksWhere({
				userId,
				hasAudioOnly: params.hasAudioOnly,
			}),
			select: {
				track: {
					select: QUEUE_TRACK_SELECT,
				},
			},
			orderBy: { createdAt: 'desc' },
		})

		const tracks = userTracks.map(userTrack => userTrack.track)
		return { tracks, total: tracks.length }
	}

	const playlistTracks = await prisma.userPlaylistTrack.findMany({
		where: {
			playlistId: params.playlistId,
			playlist: { ownerId: userId },
		},
		select: {
			track: {
				select: QUEUE_TRACK_SELECT,
			},
		},
		orderBy: { position: 'asc' },
	})

	const tracks = playlistTracks.map(playlistTrack => playlistTrack.track)
	return { tracks, total: tracks.length }
}
