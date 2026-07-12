import { type Prisma } from '#prisma/client.js'

/**
 * Page size for ServicePlaylistTrack findMany calls that use nested includes.
 * Prisma loads relations with `WHERE id IN (...)` — keep each page under SQLite's 999 bind-param limit.
 */
export const SERVICE_PLAYLIST_TRACK_PAGE_SIZE = 200

type ServicePlaylistTrackFindManyClient = {
	servicePlaylistTrack: {
		findMany: (
			args: Prisma.ServicePlaylistTrackFindManyArgs,
		) => Promise<unknown[]>
	}
}

type FindManyArgsWithoutPagination = Omit<
	Prisma.ServicePlaylistTrackFindManyArgs,
	'take' | 'skip' | 'cursor' | 'orderBy'
>

export async function findAllServicePlaylistTracks<
	T extends FindManyArgsWithoutPagination,
>(
	client: ServicePlaylistTrackFindManyClient,
	args: T,
): Promise<Prisma.ServicePlaylistTrackGetPayload<T & { orderBy: { id: 'asc' } }>[]> {
	const results: Prisma.ServicePlaylistTrackGetPayload<
		T & { orderBy: { id: 'asc' } }
	>[] = []
	let skip = 0

	while (true) {
		const page = (await client.servicePlaylistTrack.findMany({
			...args,
			orderBy: { id: 'asc' },
			take: SERVICE_PLAYLIST_TRACK_PAGE_SIZE,
			skip,
		})) as Prisma.ServicePlaylistTrackGetPayload<
			T & { orderBy: { id: 'asc' } }
		>[]

		results.push(...page)
		if (page.length < SERVICE_PLAYLIST_TRACK_PAGE_SIZE) {
			break
		}
		skip += SERVICE_PLAYLIST_TRACK_PAGE_SIZE
	}

	return results
}
