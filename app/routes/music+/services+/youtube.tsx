import { Outlet } from 'react-router'
import { type BreadcrumbHandle } from '#app/components/breadcrumbs.tsx'
import { Icon } from '#app/components/ui/icon.tsx'

export const handle: BreadcrumbHandle = {
	breadcrumb: <Icon name="link-2">YouTube</Icon>,
}

export default function YouTubeLayout() {
	return (
		<main className="container flex min-h-[400px] flex-1 px-0 pb-12 md:px-8">
			<div className="w-full">
				<Outlet />
			</div>
		</main>
	)
}
