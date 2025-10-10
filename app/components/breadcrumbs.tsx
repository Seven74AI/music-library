import { Link, useMatches } from 'react-router'
import { z } from 'zod'
import { 
	Breadcrumb, 
	BreadcrumbItem, 
	BreadcrumbLink, 
	BreadcrumbList, 
	BreadcrumbPage, 
	BreadcrumbSeparator 
} from './ui/breadcrumb'

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
			
			return {
				key: m.id,
				pathname: m.pathname,
				content: breadcrumbContent as React.ReactNode
			}
		})
		.filter(Boolean)

	if (breadcrumbs.length === 0) return null

	return (
		<Breadcrumb className="mb-6">
			<BreadcrumbList>
				{breadcrumbs.map((breadcrumb, i, arr) => (
					<BreadcrumbItem key={breadcrumb.key}>
						{i > 0 && <BreadcrumbSeparator />}
						{i === arr.length - 1 ? (
							<BreadcrumbPage>{breadcrumb.content}</BreadcrumbPage>
						) : (
							<BreadcrumbLink asChild>
								<Link to={breadcrumb.pathname}>
									{breadcrumb.content}
								</Link>
							</BreadcrumbLink>
						)}
					</BreadcrumbItem>
				))}
			</BreadcrumbList>
		</Breadcrumb>
	)
}
