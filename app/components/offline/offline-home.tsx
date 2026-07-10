import { Link } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'

export function OfflineHome() {
	return (
		<main className="py-12">
			<div className="mx-auto max-w-xl text-center">
				<Icon name="download" className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
				<h1 className="text-3xl font-bold">Listening offline</h1>
				<p className="text-muted-foreground mt-3">
					Your connection is unavailable. Open a downloaded section to keep listening.
				</p>
				<div className="mt-8 grid gap-3 sm:grid-cols-3">
					<Button asChild variant="default">
						<Link to="/downloads">Downloads</Link>
					</Button>
					<Button asChild variant="outline">
						<Link to="/library">Offline library</Link>
					</Button>
					<Button asChild variant="outline">
						<Link to="/playlists">Playlists</Link>
					</Button>
				</div>
			</div>
		</main>
	)
}
