import { SERVICE_PLAYLIST_TRACK_PAGE_SIZE } from '#app/features/service-playlist/service-playlist.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { sendEmail } from '#app/utils/email.server.ts'
import { PlaylistArchiveReadyEmail } from '#app/utils/playlist-archive-ready-email.tsx'

export async function isServicePlaylistArchiveReady(
	playlistId: string,
): Promise<boolean> {
	let skip = 0
	let hasActiveTracks = false

	while (true) {
		const page = await prisma.servicePlaylistTrack.findMany({
			where: {
				playlistId,
				isDeleted: false,
			},
			select: {
				track: {
					select: {
						audioFiles: {
							select: { id: true },
							take: 1,
						},
					},
				},
			},
			orderBy: { id: 'asc' },
			take: SERVICE_PLAYLIST_TRACK_PAGE_SIZE,
			skip,
		})

		if (page.length === 0) {
			return hasActiveTracks
		}

		hasActiveTracks = true

		if (
			page.some((playlistTrack) => playlistTrack.track.audioFiles.length === 0)
		) {
			return false
		}

		if (page.length < SERVICE_PLAYLIST_TRACK_PAGE_SIZE) {
			return true
		}

		skip += SERVICE_PLAYLIST_TRACK_PAGE_SIZE
	}
}

function resolveSiteOrigin(origin?: string): string {
	const raw =
		origin?.trim() || process.env.SITE_URL?.trim() || 'http://localhost:3000'
	return raw.replace(/\/$/, '')
}

function sendPlaylistArchiveReadyEmail({
	email,
	userName,
	playlistTitle,
	playlistUrl,
}: {
	email: string
	userName: string
	playlistTitle: string
	playlistUrl: string
}) {
	void sendEmail({
		to: email,
		subject: `Your playlist "${playlistTitle}" is ready to play`,
		react: (
			<PlaylistArchiveReadyEmail
				playlistTitle={playlistTitle}
				playlistUrl={playlistUrl}
				userName={userName}
			/>
		),
	})
}

export async function checkPlaylistArchiveReadyAfterTrackArchived(
	trackId: string,
	origin?: string,
): Promise<void> {
	const playlists = await prisma.servicePlaylist.findMany({
		where: {
			isActive: true,
			archiveReadyNotifiedAt: null,
			tracks: {
				some: {
					trackId,
					isDeleted: false,
				},
			},
		},
		select: {
			id: true,
			title: true,
			ownerId: true,
			owner: {
				select: {
					email: true,
					name: true,
					username: true,
				},
			},
		},
	})

	const siteOrigin = resolveSiteOrigin(origin)

	for (const playlist of playlists) {
		const ready = await isServicePlaylistArchiveReady(playlist.id)
		if (!ready) continue

		const playlistPath = `/music/services/youtube/playlist/${playlist.id}`
		const playlistUrl = `${siteOrigin}${playlistPath}`

		const notified = await prisma.$transaction(async (tx) => {
			const claimResult = await tx.servicePlaylist.updateMany({
				where: {
					id: playlist.id,
					archiveReadyNotifiedAt: null,
				},
				data: { archiveReadyNotifiedAt: new Date() },
			})

			if (claimResult.count === 0) return false

			await tx.userNotification.create({
				data: {
					userId: playlist.ownerId,
					type: 'playlist_archive_ready',
					title: `"${playlist.title}" is ready to play`,
					body: 'All tracks in this synced playlist have been archived.',
					linkUrl: playlistPath,
				},
			})

			return true
		})

		if (!notified) continue

		sendPlaylistArchiveReadyEmail({
			email: playlist.owner.email,
			userName: playlist.owner.name ?? playlist.owner.username,
			playlistTitle: playlist.title,
			playlistUrl,
		})
	}
}
