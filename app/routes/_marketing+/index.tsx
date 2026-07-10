import { useLoaderData } from 'react-router'
import { ListeningHome } from '#app/components/home/listening-home.tsx'
import { MarketingHome } from '#app/components/home/marketing-home.tsx'
import { OnboardingHome } from '#app/components/home/onboarding-home.tsx'
import { OfflineHome } from '#app/components/offline/offline-home.tsx'
import { loadHomeData } from '#app/utils/home.server.ts'
import { loadWithOfflineFallback } from '#app/utils/offline-route-loader.client.ts'
import { type Route } from './+types/index.ts'

export const meta: Route.MetaFunction = () => [{ title: 'Music Library' }]

export async function loader({ request }: Route.LoaderArgs) {
	return loadHomeData(request)
}

export async function clientLoader({ serverLoader }: Route.ClientLoaderArgs) {
	return loadWithOfflineFallback(
		() => serverLoader(),
		async () => ({ mode: 'offline' as const }),
	)
}

clientLoader.hydrate = true as const

export default function Index() {
	const data = useLoaderData<typeof loader | { mode: 'offline' }>()

	if ('mode' in data && data.mode === 'offline') {
		return <OfflineHome />
	}

	switch (data.mode) {
		case 'marketing':
			return <MarketingHome />
		case 'onboarding':
			return (
				<OnboardingHome
					youtubeConnected={data.youtubeConnected}
					isAdmin={data.isAdmin}
				/>
			)
		case 'gray':
			return <ListeningHome {...data} showArchivingBanner />
		case 'listening':
			return <ListeningHome {...data} showArchivingBanner={false} />
	}
}
