import { redirect, type LoaderFunctionArgs, type ActionFunctionArgs, Form } from 'react-router'

import { Button } from '#app/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card'
import { Icon } from '#app/components/ui/icon'
import { requireUserId } from '#app/utils/auth.server'
import { prisma } from '#app/utils/db.server'
import { createYouTubeOAuthService } from '#app/utils/youtube-oauth.server'

/**
 * Loader function for YouTube authentication page
 * Checks if user is already connected and redirects if so
 * 
 * @param request - The incoming request
 * @returns Promise resolving to redirect or empty data
 */
export async function loader({ request }: LoaderFunctionArgs) {
	const userId = await requireUserId(request)
	// Check if user already has tokens
	const storedTokens = await prisma.connection.findFirst({
		where: {
			providerName: 'youtube',
			userId: userId,
		},
	})
	
	if (storedTokens) {
		// User is already connected, redirect to YouTube service page
		return redirect('/music/services/youtube')
	}

	return {}
}

/**
 * Action function for YouTube authentication page
 * Generates OAuth URL and redirects to YouTube
 * 
 * @param request - The incoming request
 * @returns Promise resolving to redirect to YouTube OAuth
 */
export async function action({ request }: ActionFunctionArgs) {
	const userId = await requireUserId(request)
	
	try {
		const youtubeOAuthService = createYouTubeOAuthService()
		const authUrl = youtubeOAuthService.getAuthUrl(userId)
		
		// Redirect to YouTube OAuth
		return redirect(authUrl)
	} catch (error) {
		console.error('Error generating YouTube OAuth URL:', error)
		return redirect('/music/services/youtube/auth?error=oauth_error')
	}
}

export default function YouTubeAuthPage() {
	return (
		<div className="container mx-auto py-8">
			<div className="mb-8">
				<div className="flex items-center gap-4 mb-4">
					<Button asChild variant="outline">
						<a href="/music/services/youtube">
							<Icon name="arrow-left" className="mr-2" />
							Back to YouTube Service
						</a>
					</Button>
				</div>
				<div className="flex items-center gap-4">
					<img 
						src="/logos/youtube.svg" 
						alt="YouTube logo"
						className="w-8 h-8"
					/>
					<div>
						<h1 className="text-3xl font-bold">Connect YouTube Account</h1>
						<p className="text-muted-foreground mt-1">
							Connect your YouTube account to sync and manage your playlists
						</p>
					</div>
				</div>
			</div>

			<div className="max-w-2xl mx-auto">
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Icon name="link-2" className="h-5 w-5" />
							YouTube Integration
						</CardTitle>
						<CardDescription>
							Connect your YouTube account to access your playlists and sync them with your music library.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-6">
						<div className="space-y-4">
							<h3 className="font-semibold">What you'll be able to do:</h3>
							<ul className="space-y-2 text-sm text-muted-foreground">
								<li className="flex items-center gap-2">
									<Icon name="check" className="h-4 w-4 text-green-600" />
									Sync your YouTube playlists automatically
								</li>
								<li className="flex items-center gap-2">
									<Icon name="check" className="h-4 w-4 text-green-600" />
									Import tracks from your YouTube playlists
								</li>
								<li className="flex items-center gap-2">
									<Icon name="check" className="h-4 w-4 text-green-600" />
									Manage your YouTube playlist sync settings
								</li>
								<li className="flex items-center gap-2">
									<Icon name="check" className="h-4 w-4 text-green-600" />
									Keep your playlists up to date automatically
								</li>
							</ul>
						</div>

						<div className="space-y-4">
							<h3 className="font-semibold">Privacy & Security:</h3>
							<ul className="space-y-2 text-sm text-muted-foreground">
								<li className="flex items-center gap-2">
									<Icon name="lock-closed" className="h-4 w-4 text-blue-600" />
									We only request read-only access to your playlists
								</li>
								<li className="flex items-center gap-2">
									<Icon name="lock-closed" className="h-4 w-4 text-blue-600" />
									Your YouTube account credentials are never stored
								</li>
								<li className="flex items-center gap-2">
									<Icon name="lock-closed" className="h-4 w-4 text-blue-600" />
									You can disconnect your account at any time
								</li>
							</ul>
						</div>

						<div className="pt-4 border-t">
							<Form method="post">
								<Button type="submit" size="lg" className="w-full">
									<Icon name="link-2" className="h-5 w-5 mr-2" />
									Connect YouTube Account
								</Button>
							</Form>
							<p className="text-xs text-muted-foreground text-center mt-2">
								You'll be redirected to YouTube to authorize the connection
							</p>
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	)
}
