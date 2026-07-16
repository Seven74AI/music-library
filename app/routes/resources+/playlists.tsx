import { data } from 'react-router'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { type Route } from './+types/playlists.ts'

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await requireUserId(request)
	const playlists = await prisma.userPlaylist.findMany({
		where: { ownerId: userId },
		select: {
			id: true,
			title: true,
			description: true,
			_count: {
				select: { tracks: true },
			},
		},
		orderBy: { updatedAt: 'desc' },
	})
	return data({ playlists })
}
