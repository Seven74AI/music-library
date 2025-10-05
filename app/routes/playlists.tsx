// @context7: React, React Router, Tailwind CSS, TypeScript
/* 
    Before answering my question, MANDATORY use Context7 to fetch documentation for:

    - React
    - React Router
    - Tailwind CSS
    - TypeScript
    - resolve-library-id: React
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: React Router
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: Tailwind CSS
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: TypeScript
    - get-library-docs: [resolved-id] (focus: general usage)

    Context7 Instructions:
    - resolve-library-id: React
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: React Router
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: Tailwind CSS
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: TypeScript
    - get-library-docs: [resolved-id] (focus: general usage)

    ⚠️  DO NOT PROCEED WITHOUT FETCHING ALL DOCUMENTATION ABOVE!
*/
import { Outlet } from 'react-router'

export default function PlaylistsLayout() {
	return (
		<main className="container flex min-h-[400px] flex-1 px-0 pb-12 md:px-8">
			<div className="w-full">
				<Outlet />
			</div>
		</main>
	)
}
