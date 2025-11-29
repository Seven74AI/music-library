import { styleText } from 'node:util'
import { remember } from '@epic-web/remember'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
// Changed import due to issue: https://github.com/remix-run/react-router/pull/12644
import { PrismaClient } from '#prisma/client.js'
import { getDatabaseUrl } from './database-url.server.ts'

export const prisma = remember('prisma', () => {
	// NOTE: if you change anything in this function you'll need to restart
	// the dev server to see your changes.

	// Always 20ms threshold as requested
	const logThreshold = 20

	const adapter = new PrismaBetterSqlite3({
		url: getDatabaseUrl(),
	})

	const client = new PrismaClient({
		adapter,
		log: [
			{ level: 'query', emit: 'event' },
			{ level: 'error', emit: 'stdout' },
			{ level: 'warn', emit: 'stdout' },
		],
	})
	client.$on('query', async (e) => {
		if (e.duration < logThreshold) return
		
		// Analyze query complexity
		const hasJoins = e.query.includes('JOIN')
		const hasSubqueries = e.query.includes('SELECT') && e.query.split('SELECT').length > 2
		const hasOrderBy = e.query.includes('ORDER BY')
		const hasGroupBy = e.query.includes('GROUP BY')
		const hasDistinct = e.query.includes('DISTINCT')
		
		const complexity = [
			hasJoins ? '[JOINS]' : '',
			hasSubqueries ? '[SUBQUERY]' : '',
			hasOrderBy ? '[ORDER]' : '',
			hasGroupBy ? '[GROUP]' : '',
			hasDistinct ? '[DISTINCT]' : '',
		].filter(Boolean).join(' ')
		
		const color =
			e.duration < logThreshold * 1.1
				? 'green'
				: e.duration < logThreshold * 1.2
					? 'blue'
					: e.duration < logThreshold * 1.3
						? 'yellow'
						: e.duration < logThreshold * 1.4
							? 'redBright'
							: 'red'
		const dur = styleText(color, `${e.duration}ms`)
		console.info(`prisma:query - ${dur} - ${e.query} ${complexity}`)
	})
	void client.$connect()
	return client
})
