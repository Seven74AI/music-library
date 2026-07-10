import { data } from 'react-router'
import { requireUserId } from '#app/utils/auth.server.ts'
import {
	markAllNotificationsRead,
	markNotificationRead,
} from '#app/utils/playlist-archive-ready.server.tsx'
import { type Route } from './+types/notifications.ts'

export async function action({ request }: Route.ActionArgs) {
	const userId = await requireUserId(request)
	const formData = await request.formData()
	const intent = formData.get('intent')

	if (intent === 'mark-all-read') {
		await markAllNotificationsRead(userId)
		return data({ ok: true })
	}

	if (intent === 'mark-read') {
		const notificationId = formData.get('notificationId')
		if (typeof notificationId !== 'string') {
			return data({ ok: false }, { status: 400 })
		}

		const marked = await markNotificationRead(notificationId, userId)
		if (!marked) {
			return data({ ok: false }, { status: 404 })
		}

		return data({ ok: true })
	}

	return data({ ok: false }, { status: 400 })
}
