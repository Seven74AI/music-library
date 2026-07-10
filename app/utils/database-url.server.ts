import { join } from 'node:path'

/**
 * Centralized DATABASE_URL helper
 *
 * Provides a single source of truth for the database URL across the application.
 * Strips query params (e.g. ?connection_limit=1) that better-sqlite3 treats as
 * part of the filename, and resolves relative file: paths to absolute paths.
 */
export function getDatabaseUrl(): string {
	const raw = process.env.DATABASE_URL || 'file:./data.db'
	const withoutQuery = raw.split('?')[0] ?? raw

	if (withoutQuery.startsWith('file:./')) {
		return `file:${join(process.cwd(), withoutQuery.slice('file:'.length + 1))}`
	}

	return withoutQuery
}

