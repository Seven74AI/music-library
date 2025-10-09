import { redirect, type LoaderFunctionArgs } from 'react-router'
import { requireUserId } from '#app/utils/auth.server'
import { prisma } from '#app/utils/db.server'
import { createYouTubeOAuthService } from '#app/utils/youtube-oauth.server'

export async function loader({ request }: LoaderFunctionArgs) {
	const userId = await requireUserId(request)
	const url = new URL(request.url)
	const code = url.searchParams.get('code')
	const error = url.searchParams.get('error')

	if (error) {
		// Handle OAuth error
		return redirect('/music/services/youtube/auth?error=oauth_failed')
	}

	if (!code) {
		// No code parameter, redirect to auth
		return redirect('/music/services/youtube/auth')
	}

	try {
		const youtubeOAuthService = createYouTubeOAuthService()
		
		// Exchange code for tokens
		const tokens = await youtubeOAuthService.getTokens(code)
		
		// Store tokens for the user
		await prisma.connection.upsert({
			where: {
				providerName_providerId: {
					providerName: 'youtube',
					providerId: 'youtube'
				}
			},
			update: {
				tokens: JSON.stringify(tokens)
			},
			create: {
				userId: userId,
				providerName: 'youtube',
				providerId: 'youtube',
				tokens: JSON.stringify(tokens)
			}
		})
		
		// Success - redirect to YouTube service page
		return redirect('/music/services/youtube?connected=true')
	} catch (error) {
		console.error('YouTube OAuth callback error:', error)
		return redirect('/music/services/youtube/auth?error=callback_failed')
	}
}
