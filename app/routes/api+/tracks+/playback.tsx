import {
	fetchPlaybackTracks,
	parsePlaybackIds,
} from '#app/features/queue/queue-playback.server.ts'
import { requireUserId } from '#app/utils/auth.server.ts'

export async function loader({ request, url }: { request: Request; url: URL }) {
	try {
		const userId = await requireUserId(request)
		
		const parsed = parsePlaybackIds(url.searchParams.get('ids'))

		if (!parsed.ok) {
			return Response.json({ error: parsed.error }, { status: 400 })
		}

		const result = await fetchPlaybackTracks(userId, parsed.value)
		return Response.json(result, {
			headers: {
				'Cache-Control': 'private, max-age=30',
			},
		})
	} catch (error) {
		if (error instanceof Response) throw error
		console.error('Error fetching playback tracks:', error)
		return Response.json(
			{ error: 'Failed to fetch playback tracks' },
			{ status: 500 },
		)
	}
}
