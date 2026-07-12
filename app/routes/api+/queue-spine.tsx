import { requireUserId } from '#app/utils/auth.server.ts'
import {
	fetchQueueSpine,
	parseQueueSpineParams,
} from '#app/features/queue/queue-spine.server.ts'

export async function loader({ request }: { request: Request }) {
	try {
		const userId = await requireUserId(request)
		const url = new URL(request.url)
		const parsed = parseQueueSpineParams(url.searchParams)

		if (!parsed.ok) {
			return Response.json({ error: parsed.error }, { status: 400 })
		}

		const result = await fetchQueueSpine(userId, parsed.value)
		return Response.json(result)
	} catch (error) {
		console.error('Error fetching queue spine:', error)
		return Response.json({ error: 'Failed to fetch queue spine' }, { status: 500 })
	}
}
