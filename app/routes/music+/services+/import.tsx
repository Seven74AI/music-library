import { Outlet } from 'react-router'

export default function ImportLayout() {
	return (
		<main className="container flex min-h-[400px] flex-1 px-0 pb-12 md:px-8">
			<div className="w-full">
				<Outlet />
			</div>
		</main>
	)
}