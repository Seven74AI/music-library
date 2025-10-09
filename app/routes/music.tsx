import { Outlet } from 'react-router'
import { Breadcrumbs, type BreadcrumbHandle } from '#app/components/breadcrumbs.tsx'
import { Icon } from '#app/components/ui/icon.tsx'

export const handle: BreadcrumbHandle = {
	breadcrumb: <Icon name="file-text">Music</Icon>,
}

export default function MusicLayout() {
	return (
		<main className="container flex min-h-[400px] flex-1 px-0 pb-12 md:px-8">
			<div className="w-full">
				<Breadcrumbs />
				<Outlet />
			</div>
		</main>
	)
}