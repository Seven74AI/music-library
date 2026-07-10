import { Link } from 'react-router'
import { Icon } from '#app/components/ui/icon.tsx'
import { useOnlineStatus } from '#app/hooks/use-online-status.ts'

export function OfflineStatusBanner() {
	const isOnline = useOnlineStatus()

	if (isOnline) return null

	return (
		<div
			role="status"
			className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-950 dark:text-amber-100"
		>
			<div className="container flex flex-wrap items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<Icon name="download" className="h-4 w-4 shrink-0" />
					<span>You&apos;re offline. Showing downloaded music only.</span>
				</div>
				<nav className="flex items-center gap-3 text-sm font-medium">
					<Link to="/downloads" className="underline-offset-4 hover:underline">
						Downloads
					</Link>
					<Link to="/library" className="underline-offset-4 hover:underline">
						Library
					</Link>
					<Link to="/playlists" className="underline-offset-4 hover:underline">
						Playlists
					</Link>
				</nav>
			</div>
		</div>
	)
}
