import { prisma } from '#app/utils/db.server.ts'
import { sendEmail } from '#app/utils/email.server.ts'
import { PlaylistArchiveReadyEmail } from '#app/utils/playlist-archive-ready-email.tsx'

export async function isServicePlaylistArchiveReady(
	playlistId: string,
): Promise<boolean> {
	// Single query: if ANY track has no audio files, the playlist is NOT ready.
	// Uses `none: {}` to short-circuit — SQLite stops scanning at first match.
	const missingAudio = await prisma.servicePlaylistTrack.findFirst({
		where: {
			playlistId,
			isDeleted: false,
			track: { audioFiles: { none: {} } },
		},
		select: { id: true },
	})

	return missingAudio === null
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
