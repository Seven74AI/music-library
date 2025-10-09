import { Link, useMatches } from 'react-router'
import { z } from 'zod'
import { cn } from '../utils/misc.tsx'
import { Icon } from './ui/icon.tsx'

export const BreadcrumbHandle = z.object({ 
	breadcrumb: z.union([
		z.custom<React.ReactNode>(), 
		z.function().args(z.object({ data: z.unknown() })).returns(z.custom<React.ReactNode>())
	])
})
export type BreadcrumbHandle = z.infer<typeof BreadcrumbHandle>

export function Breadcrumbs() {
	const matches = useMatches()
	const breadcrumbs = matches
		.map((m) => {
			if (!m.handle || typeof m.handle !== 'object' || !('breadcrumb' in m.handle)) return null
			
			const breadcrumb = m.handle.breadcrumb
			const breadcrumbContent = typeof breadcrumb === 'function' 
				? breadcrumb({ data: m.data }) 
				: breadcrumb
			
			return (
				<Link key={m.id} to={m.pathname} className="flex items-center">
					{breadcrumbContent as React.ReactNode}
				</Link>
			)
		})
		.filter(Boolean)

	if (breadcrumbs.length === 0) return null

	return (
		<nav aria-label="breadcrumb" className="mb-6">
			<ol className="flex gap-3">
				{breadcrumbs.map((breadcrumb, i, arr) => (
					<li
						key={i}
						className={cn('flex items-center gap-3', {
							'text-muted-foreground': i < arr.length - 1,
						})}
					>
						{i > 0 && <Icon name="arrow-right" size="sm" />}
						{breadcrumb}
					</li>
				))}
			</ol>
		</nav>
	)
}
