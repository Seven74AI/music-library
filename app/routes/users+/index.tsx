// Raw SQL query for user search
import { Img } from 'openimg/react'
import { redirect, Link } from 'react-router'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { ErrorList } from '#app/components/forms.tsx'
import { SearchBar } from '#app/components/search-bar.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { cn, getUserImgSrc, useDelayedIsPending } from '#app/utils/misc.tsx'
import { type Route } from './+types/index.ts'

// Type for the search result from the SQL query
type SearchUser = {
	id: string
	username: string
	name: string | null
	imageId: string | null
	imageObjectKey: string | null
}

/**
 * Loader function for the users search page
 * Handles user search functionality with case-insensitive matching
 * 
 * @param request - The incoming request containing search parameters
 * @returns Promise resolving to user data and status
 */
export async function loader({ request }: Route.LoaderArgs) {
	const searchTerm = new URL(request.url).searchParams.get('search')
	if (searchTerm === '') {
		return redirect('/users')
	}

	try {
		const like = `%${searchTerm ?? ''}%`

		// Execute the raw SQL query with proper parameter binding
		const users = await prisma.$queryRaw<SearchUser[]>`
			SELECT 
				"User".id,
				"User".username,
				"User".name,
				"UserImage".id AS imageId,
				"UserImage".objectKey AS imageObjectKey
			FROM "User"
			LEFT JOIN "UserImage" ON "User".id = "UserImage".userId
			WHERE "User".username LIKE ${like}
			OR "User".name LIKE ${like}
			ORDER BY "User".createdAt DESC
			LIMIT 50
		`
		return { status: 'idle', users } as const
	} catch (error) {
		console.error('Error searching users:', error)
		return { status: 'error', users: [] } as const
	}
}

/**
 * Users search page component
 * Displays a searchable list of users with their profile information
 * 
 * @param loaderData - Data loaded by the loader function
 * @returns JSX element representing the users search page
 */
export default function UsersRoute({ loaderData }: Route.ComponentProps) {
	const isPending = useDelayedIsPending({
		formMethod: 'GET',
		formAction: '/users',
	})

	return (
		<div className="container mt-36 mb-48 flex flex-col items-center justify-center gap-6">
			<h1 className="text-h1">Music Library Users</h1>
			<div className="w-full max-w-[700px]">
				<SearchBar status={loaderData.status} autoFocus autoSubmit />
			</div>
			<main>
				{loaderData.status === 'idle' ? (
					loaderData.users.length ? (
						<ul
							className={cn(
								'flex w-full flex-wrap items-center justify-center gap-4 delay-200',
								{ 'opacity-50': isPending },
							)}
						>
							{loaderData.users.map((user) => {
								if (!user) return null
								return (
									<li key={user.id}>
										<Link
											to={user.username}
											className="bg-muted flex h-36 w-44 flex-col items-center justify-center rounded-lg px-5 py-3"
											aria-label={`${user.name || user.username} profile`}
										>
											<Img
												alt={user.name ?? user.username}
												src={getUserImgSrc(user.imageObjectKey)}
												className="size-16 rounded-full"
												width={256}
												height={256}
											/>
											{user.name ? (
												<span className="text-body-md w-full overflow-hidden text-center text-ellipsis whitespace-nowrap">
													{user.name}
												</span>
											) : null}
											<span className="text-body-sm text-muted-foreground w-full overflow-hidden text-center text-ellipsis">
												{user.username}
											</span>
										</Link>
									</li>
								)
							})}
						</ul>
					) : (
						<p>No users found</p>
					)
				) : loaderData.status === 'error' ? (
					<ErrorList errors={['There was an error parsing the results']} />
				) : null}
			</main>
		</div>
	)
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
