import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { LIBRARY_TRACKS_PAGE_SIZE } from '#app/utils/library-tracks-pagination.ts'
import {
	buildLibraryUserTracksWhere,
	parseHasAudioOnlyParam,
} from '#app/utils/library-user-tracks.server.ts'

export async function loader({ request, url }: { request: Request; url: URL }) {
	try {
		const userId = await requireUserId(request)
		
		const cursor = url.searchParams.get('cursor')
		const limitParam = url.searchParams.get('limit')
		const limit = parseInt(limitParam || String(LIBRARY_TRACKS_PAGE_SIZE))
		const fields = url.searchParams.get('fields') || 'full' // 'minimal' or 'full'
		const hasAudioParam = url.searchParams.get('hasAudio')

		if (isNaN(limit) || limit < 1 || limit > 100) {
			return Response.json({ error: 'Invalid limit parameter' }, { status: 400 })
		}

		if (hasAudioParam !== null && hasAudioParam !== '1') {
			return Response.json({ error: 'Invalid hasAudio parameter' }, { status: 400 })
		}

		const hasAudioOnly = parseHasAudioOnlyParam(url.searchParams)
		const isMinimal = fields === 'minimal'

		const userTracksRaw = await prisma.userTrack.findMany({
			where: buildLibraryUserTracksWhere({ userId, hasAudioOnly }),
			include: {
				track: isMinimal
					? {
							select: {
								id: true,
								title: true,
								artist: {
									select: {
										id: true,
										name: true,
									},
								},
							},
						}
					: {
							include: {
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
				service: {
					select: {
						displayName: true,
						logoUrl: true,
					},
				},
				audioFiles: {
					select: {
						id: true,
						format: true,
						objectKey: true,
					},
				},
							},
						},
			},
			orderBy: { createdAt: 'desc' },
			take: limit,
			...(cursor && {
				skip: 1, // Skip the cursor item
				cursor: { id: cursor },
			}),
		})

		// Return tracks with relations (no transformations needed)
		const userTracks = userTracksRaw

		const hasNext = userTracks.length === limit
		const nextCursor = hasNext ? userTracks[userTracks.length - 1]?.id : null

		return Response.json({
			userTracks,
			pagination: {
				hasNext,
				nextCursor,
				limit,
			},
		})
	} catch (error) {
		console.error('Error fetching user tracks:', error)
		return Response.json({ error: 'Failed to fetch tracks' }, { status: 500 })
	}
}
