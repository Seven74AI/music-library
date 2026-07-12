import { type ActionFunctionArgs } from 'react-router'
import { YOUTUBE_SERVICE } from '#app/constants/services'
import { disconnectServiceConnection } from '#app/features/service-connection/service-connection.server'
import { requireUserId } from '#app/utils/auth.server'
import { redirectWithToast } from '#app/utils/toast.server'

export async function action({ request }: ActionFunctionArgs) {
	const userId = await requireUserId(request)
	
	const success = await disconnectServiceConnection(YOUTUBE_SERVICE.NAME, userId)
	
	if (success) {
		return redirectWithToast('/music/services/youtube', {
			title: 'Disconnected',
			description: 'YouTube account disconnected successfully',
			type: 'success',
		})
	} else {
		return redirectWithToast('/music/services/youtube', {
			description: 'Failed to disconnect YouTube account. Please try again.',
			type: 'error',
		})
	}
}
