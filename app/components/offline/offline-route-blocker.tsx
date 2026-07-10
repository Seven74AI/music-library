import { Link } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { useOnlineStatus } from '#app/hooks/use-online-status.ts'

type OfflineRouteBlockerProps = {
	children: React.ReactNode
}

export function OfflineRouteBlocker({ children }: OfflineRouteBlockerProps) {
	const isOnline = useOnlineStatus()

	if (isOnline) return children

	return (
		<main className="py-12">
			<div className="mx-auto max-w-lg text-center">
				<Icon name="download" className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
				<h1 className="text-2xl font-semibold">You&apos;re offline</h1>
				<p className="text-muted-foreground mt-3">
					This page needs a network connection. Open Downloads to play music you saved
					for offline listening.
				</p>
				<div className="mt-6 flex flex-wrap justify-center gap-3">
					<Button asChild>
						<Link to="/downloads">Open downloads</Link>
					</Button>
					<Button asChild variant="outline">
						<Link to="/library">Offline library</Link>
					</Button>
				</div>
			</div>
		</main>
	)
}
