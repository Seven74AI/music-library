import { type LoaderFunctionArgs } from 'react-router'
import { requireUserId } from '#app/utils/auth.server'
import { prisma } from '#app/utils/db.server'
import { redirectWithToast } from '#app/utils/toast.server'
import { createYouTubeOAuthService } from '#app/utils/youtube-oauth.server'
import { createYouTubePlaylistService } from '#app/utils/youtube-playlist.server'

export async function loader({ request }: LoaderFunctionArgs) {
  const userId = await requireUserId(request)
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')

  if (error) {
    console.error('YouTube OAuth error:', error)
    return redirectWithToast('/youtube/playlists', {
      title: 'Authentication Failed',
      description: 'There was an error authenticating with YouTube. Please try again.',
      type: 'error',
    })
  }

  if (!code) {
    return redirectWithToast('/youtube/playlists', {
      title: 'Authentication Failed',
      description: 'No authorization code received from YouTube.',
      type: 'error',
    })
  }

  try {
    const oauthService = createYouTubeOAuthService()
    const tokens = await oauthService.getTokens(code)

    if (!tokens.access_token) {
      throw new Error('No access token received')
    }

    // Get YouTube user info to store proper providerId
    const youtubeService = createYouTubePlaylistService()
    const youtubeUserInfo = await youtubeService.getYouTubeUserInfo(tokens.access_token)
    
    // Store tokens in user's connection for future use
    await prisma.connection.upsert({
      where: {
        providerName_providerId: {
          providerName: 'youtube',
          providerId: youtubeUserInfo.id, // Use YouTube user ID as providerId
        },
      },
      update: {
        tokens: JSON.stringify({
          youtubeUserId: youtubeUserInfo.id,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiryDate: tokens.expiry_date,
        }),
        updatedAt: new Date(),
      },
      create: {
        providerName: 'youtube',
        providerId: youtubeUserInfo.id,
        tokens: JSON.stringify({
          youtubeUserId: youtubeUserInfo.id,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiryDate: tokens.expiry_date,
        }),
        userId: userId,
      },
    })

    // Sync the playlists immediately
    const playlistService = createYouTubePlaylistService()
    await playlistService.syncUserPlaylists(userId, tokens.access_token)

    return redirectWithToast('/youtube/playlists', {
      title: 'Success!',
      description: 'Your YouTube playlists have been synced successfully.',
      type: 'success',
    })
  } catch (error) {
    console.error('Error processing YouTube OAuth callback:', error)
    console.error('Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      code: url.searchParams.get('code'),
      error: url.searchParams.get('error'),
    })
    return redirectWithToast('/youtube/playlists', {
      title: 'Sync Failed',
      description: `Error processing YouTube authentication: ${error instanceof Error ? error.message : 'Unknown error'}`,
      type: 'error',
    })
  }
}
