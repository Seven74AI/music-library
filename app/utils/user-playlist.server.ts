import { prisma } from '#app/utils/db.server.ts'

export type AddTrackToUserPlaylistInput = {
	userId: string
	playlistId: string
	trackId: string
	forceDuplicate?: boolean
}

export type AddTrackToUserPlaylistResult =
	| { status: 'success'; playlistTitle: string }
	| { status: 'not_found' }
	| {
			status: 'duplicate'
			playlistId: string
			playlistTitle: string
	  }

export async function addTrackToUserPlaylist({
	userId,
	playlistId,
	trackId,
	forceDuplicate = false,
}: AddTrackToUserPlaylistInput): Promise<AddTrackToUserPlaylistResult> {
	const playlist = await prisma.userPlaylist.findFirst({
		where: { id: playlistId, ownerId: userId },
		select: { id: true, title: true },
	})

	if (!playlist) {
		return { status: 'not_found' }
	}

	if (!forceDuplicate) {
		const existing = await prisma.userPlaylistTrack.findFirst({
			where: { playlistId, trackId },
		})

		if (existing) {
			return {
				status: 'duplicate',
				playlistId,
				playlistTitle: playlist.title,
			}
		}
	}

	const maxPosition = await prisma.userPlaylistTrack.aggregate({
		where: { playlistId },
		_max: { position: true },
	})

	await prisma.userPlaylistTrack.create({
		data: {
			playlistId,
			trackId,
			position: (maxPosition._max.position ?? -1) + 1,
		},
	})

	return { status: 'success', playlistTitle: playlist.title }
}
