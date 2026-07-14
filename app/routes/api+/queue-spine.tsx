import {
	fetchQueueSpine,
	parseQueueSpineParams,
} from '#app/features/queue/queue-spine.server.ts'
import { requireUserId } from '#app/utils/auth.server.ts'

export async function loader({ request, url }: { request: Request; url: URL }) {
	try {
		const userId = await requireUserId(request)
		
		const parsed = parseQueueSpineParams(url.searchParams)

		if (!parsed.ok) {
			return Response.json({ error: parsed.error }, { status: 400 })
		}

		const result = await fetchQueueSpine(userId, parsed.value)
		return Response.json(result)
	} catch (error) {
		if (error instanceof Response) throw error
		console.error('Error fetching queue spine:', error)
		return Response.json({ error: 'Failed to fetch queue spine' }, { status: 500 })
	}
}
