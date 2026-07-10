import { Outlet } from 'react-router'
import { OfflineRouteBlocker } from '#app/components/offline/offline-route-blocker.tsx'

export default function AdminLayout() {
	return (
		<OfflineRouteBlocker>
			<Outlet />
		</OfflineRouteBlocker>
	)
}
