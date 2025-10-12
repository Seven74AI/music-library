import { type ActionFunctionArgs } from 'react-router'
import { requireUserId } from '#app/utils/auth.server'
import { redirectWithToast } from '#app/utils/toast.server'
import { disconnectYouTube } from '#app/utils/youtube-oauth-validation.server'

export async function action({ request }: ActionFunctionArgs) {
	const userId = await requireUserId(request)
	
	const success = await disconnectYouTube(userId)
	
	if (success) {
		return redirectWithToast('/music/services/youtube', {
			description: 'YouTube account disconnected successfully',
			type: 'destructive',
		})
	} else {
		return redirectWithToast('/music/services/youtube', {
			description: 'Failed to disconnect YouTube account. Please try again.',
			type: 'error',
		})
	}
}
