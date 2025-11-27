import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'

export async function loader({ request }: { request: Request }) {
	try {
		const userId = await requireUserId(request)
		const url = new URL(request.url)
		const playlistId = url.searchParams.get('playlistId')
		const cursor = url.searchParams.get('cursor')
		const limitParam = url.searchParams.get('limit')
		const limit = parseInt(limitParam || '50')

		if (!playlistId) {
			return Response.json({ error: 'Playlist ID is required' }, { status: 400 })
		}

		if (isNaN(limit) || limit < 1 || limit > 100) {
			return Response.json({ error: 'Invalid limit parameter' }, { status: 400 })
		}

		const playlistTracks = await prisma.userPlaylistTrack.findMany({
			where: { 
				playlistId,
				playlist: { ownerId: userId } // Ensure user owns the playlist
			},
			include: {
				track: {
					include: {
						service: true,
					},
				},
			},
			orderBy: { position: 'asc' },
			take: limit,
			...(cursor && {
				skip: 1, // Skip the cursor item
				cursor: { id: cursor },
			}),
		})

		const hasNext = playlistTracks.length === limit
		const nextCursor = hasNext ? playlistTracks[playlistTracks.length - 1]?.id : null

		return Response.json({
			tracks: playlistTracks.map((pt: any) => pt.track),
			pagination: {
				hasNext,
				nextCursor,
				limit,
			},
		})
	} catch (error) {
		console.error('Error fetching playlist tracks:', error)
		return Response.json({ error: 'Failed to fetch tracks' }, { status: 500 })
	}
}
