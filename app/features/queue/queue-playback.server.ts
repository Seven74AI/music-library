import { prisma } from '#app/utils/db.server.ts'
import { type FullTrack } from '#app/types/frontend/shared.ts'

export const PLAYBACK_TRACK_MAX_IDS = 20

export const PLAYBACK_TRACK_SELECT = {
	id: true,
	title: true,
	duration: true,
	artist: {
		select: {
			id: true,
			name: true,
		},
	},
	coverImage: {
		select: {
			objectKey: true,
		},
	},
	audioFiles: {
		select: {
			id: true,
			format: true,
			objectKey: true,
		},
	},
} as const

type ParseResult =
	| { ok: true; value: string[] }
	| { ok: false; error: string }

export function parsePlaybackIds(idsParam: string | null): ParseResult {
	if (!idsParam) {
		return { ok: false, error: 'Track IDs are required' }
	}

	const ids = idsParam
		.split(',')
		.map(id => id.trim())
		.filter(Boolean)

	if (ids.length === 0) {
		return { ok: false, error: 'Track IDs are required' }
	}

	if (ids.length > PLAYBACK_TRACK_MAX_IDS) {
		return { ok: false, error: 'Too many track IDs' }
	}

	return { ok: true, value: ids }
}

function buildUserTrackAccessWhere(userId: string) {
	return {
		OR: [
			{
				userTracks: {
					some: {
						userId,
						isActive: true,
						deletedAt: null,
					},
				},
			},
			{
				servicePlaylistTracks: {
					some: {
						playlist: {
							ownerId: userId,
							isActive: true,
						},
					},
				},
			},
			{
				userPlaylistTracks: {
					some: {
						playlist: {
							ownerId: userId,
						},
					},
				},
			},
		],
	}
}

export async function fetchPlaybackTracks(
	userId: string,
	trackIds: string[],
): Promise<{ tracks: FullTrack[] }> {
	const tracks = await prisma.track.findMany({
		where: {
			id: { in: trackIds },
			...buildUserTrackAccessWhere(userId),
		},
		select: PLAYBACK_TRACK_SELECT,
	})

	const tracksById = new Map(tracks.map(track => [track.id, track]))
	const orderedTracks: FullTrack[] = []
	for (const id of trackIds) {
		const track = tracksById.get(id)
		if (track) orderedTracks.push(track)
	}

	return { tracks: orderedTracks }
}
