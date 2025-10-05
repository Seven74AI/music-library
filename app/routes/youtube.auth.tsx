import { type LoaderFunctionArgs, redirect } from 'react-router'
import { requireUserId } from '#app/utils/auth.server'
import { redirectWithToast } from '#app/utils/toast.server'
import { createYouTubeOAuthService } from '#app/utils/youtube-oauth.server'

export async function loader({ request }: LoaderFunctionArgs) {
  const userId = await requireUserId(request)
  
  try {
    const oauthService = createYouTubeOAuthService()
    const authUrl = oauthService.getAuthUrl(userId)
    
    return redirect(authUrl)
  } catch (error) {
    console.error('Error initiating YouTube OAuth:', error)
    return redirectWithToast('/youtube/playlists', {
      title: 'Authentication Failed',
      description: 'Failed to initiate YouTube authentication. Please try again.',
      type: 'error',
    })
  }
}
