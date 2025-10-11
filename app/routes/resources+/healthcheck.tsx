// @context7: Fetch API, Fly.io, Prisma
/* 
    Before answering my question, MANDATORY use Context7 to fetch documentation for:

    - Fetch API
    - Fly.io
    - Prisma
    - resolve-library-id: Fetch API
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: Fly.io
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: Prisma
    - get-library-docs: [resolved-id] (focus: general usage)

    Context7 Instructions:
    - resolve-library-id: Fetch API
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: Fly.io
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: Prisma
    - get-library-docs: [resolved-id] (focus: general usage)

    ⚠️  DO NOT PROCEED WITHOUT FETCHING ALL DOCUMENTATION ABOVE!
*/
// learn more: https://fly.io/docs/reference/configuration/#services-http_checks
import { prisma } from '#app/utils/db.server.ts'
import { type Route } from './+types/healthcheck.ts'

export async function loader({ request }: Route.LoaderArgs) {
	const host =
		request.headers.get('X-Forwarded-Host') ?? request.headers.get('host')

	try {
		// if we can connect to the database and make a simple query
		// and make a HEAD request to ourselves, then we're good.
		await Promise.all([
			prisma.user.count(),
			fetch(`${new URL(request.url).protocol}${host}`, {
				method: 'HEAD',
				headers: { 'X-Healthcheck': 'true' },
			}).then((r) => {
				if (!r.ok) return Promise.reject(r)
				return new Response('OK')
			}),
		])
		return new Response('OK')
	} catch (error: unknown) {
		console.log('healthcheck ❌', { error })
		return new Response('ERROR', { status: 500 })
	}
}
