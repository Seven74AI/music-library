/**
 * Centralized DATABASE_URL helper
 * 
 * Provides a single source of truth for the database URL across the application.
 * This ensures consistency between Prisma Client instances and Prisma CLI commands.
 * 
 * @returns The DATABASE_URL from environment variables or a sensible default
 */
export function getDatabaseUrl(): string {
	return process.env.DATABASE_URL || 'file:./prisma/data.db'
}

