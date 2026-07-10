import { useLoaderData } from 'react-router'
import { ListeningHome } from '#app/components/home/listening-home.tsx'
import { MarketingHome } from '#app/components/home/marketing-home.tsx'
import { OnboardingHome } from '#app/components/home/onboarding-home.tsx'
import { loadHomeData } from '#app/utils/home.server.ts'
import { type Route } from './+types/index.ts'

export const meta: Route.MetaFunction = () => [{ title: 'Music Library' }]

export async function loader({ request }: Route.LoaderArgs) {
	return loadHomeData(request)
}

export default function Index() {
	const data = useLoaderData<typeof loader>()

	switch (data.mode) {
		case 'marketing':
			return <MarketingHome />
		case 'onboarding':
			return <OnboardingHome youtubeConnected={data.youtubeConnected} />
		case 'gray':
			return <ListeningHome {...data} showArchivingBanner />
		case 'listening':
			return <ListeningHome {...data} showArchivingBanner={false} />
	}
}
