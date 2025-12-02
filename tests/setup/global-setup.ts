import path from 'node:path'
import { type FullConfig } from '@playwright/test'
import { execaCommand } from 'execa'
import fsExtra from 'fs-extra'

// Set DATABASE_URL for the test process BEFORE any other imports
// This ensures all prisma calls in tests use the test database
export const BASE_DATABASE_PATH = path.join(
	process.cwd(),
	`./tests/prisma/base.db`,
)

// DATABASE_URL is set via cross-env in npm scripts
// This ensures it's available for both the test process and globalSetup
import 'dotenv/config'
import '#app/utils/env.server.ts'
import '#app/utils/cache.server.ts'

export async function setup() {
	// Ensure the database directory exists before any database operations
	// SQLite requires the parent directory to exist before creating the database file
	const databaseDir = path.dirname(BASE_DATABASE_PATH)
	await fsExtra.ensureDir(databaseDir)

	const databaseExists = await fsExtra.pathExists(BASE_DATABASE_PATH)

	// Check migration status to see if database is in sync
	let needsMigration = true
	if (databaseExists) {
		try {
			// Check if migrations are up to date
			const statusResult = await execaCommand(
				'npx prisma migrate status',
				{
					env: {
						...process.env,
						DATABASE_URL: `file:${BASE_DATABASE_PATH}`,
					},
					reject: false, // Don't throw on error
				},
			)
			
			// If migrations are in sync, skip migration step
			// Exit code 0 means migrations are up to date (Prisma standard behavior)
			// Also check stdout for confirmation message as additional validation
			if (statusResult.exitCode === 0 && 
				(statusResult.stdout.includes('Database schema is up to date') || 
				 statusResult.stdout.includes('are in sync'))) {
				needsMigration = false
				console.log('✅ Database migrations are up to date')
			} else {
				console.log('⚠️  Database migrations are out of sync, will reset and reapply')
				if (statusResult.stderr) {
					console.log('Migration status error:', statusResult.stderr)
				}
				// Delete the database to force a clean migration
				await fsExtra.remove(BASE_DATABASE_PATH)
			}
		} catch (error) {
			console.log('⚠️  Could not check migration status, will reset database:', error)
			// If we can't check status, delete and recreate
			await fsExtra.remove(BASE_DATABASE_PATH)
		}
	}

	if (needsMigration) {
		// Use migrate deploy instead of reset for more reliable test database setup
		// migrate deploy creates the database if it doesn't exist and applies all migrations
		console.log('📦 Applying database migrations...')
		await execaCommand(
			'npx prisma migrate deploy',
			{
				stdio: 'inherit',
				env: {
					...process.env,
					DATABASE_URL: `file:${BASE_DATABASE_PATH}`,
				},
			},
		)
	}

	// Generate Prisma Client after migrations to ensure it matches the database schema
	console.log('🔧 Generating Prisma Client...')
	await execaCommand(
		'npx prisma generate',
		{
			stdio: 'inherit',
			env: {
				...process.env,
				DATABASE_URL: `file:${BASE_DATABASE_PATH}`,
			},
		},
	)

	// Verify that the User table exists before running seed
	console.log('✅ Verifying database schema...')
	const { PrismaClient } = await import('#prisma/client.js')
	const { PrismaBetterSqlite3 } = await import('@prisma/adapter-better-sqlite3')
	
	const adapter = new PrismaBetterSqlite3({
		url: `file:${BASE_DATABASE_PATH}`,
	})
	const prisma = new PrismaClient({ adapter })
	
	try {
		// Try to query the User table to verify it exists
		await prisma.user.findFirst({ take: 1 })
		console.log('✅ Database schema verified - User table exists')
	} catch (error) {
		console.error('❌ Database schema verification failed:', error)
		throw new Error('Database schema verification failed - User table does not exist')
	} finally {
		await prisma.$disconnect()
	}

	// Run seed script with correct DATABASE_URL
	console.log('🌱 Seeding database...')
	await execaCommand(
		'npx prisma db seed',
		{
			stdio: 'inherit',
			env: {
				...process.env,
				DATABASE_URL: `file:${BASE_DATABASE_PATH}`,
			},
		},
	)
}

// Playwright global setup function
export default async function globalSetup(_config: FullConfig) {
	console.log('🔧 Setting up test database...')
	await setup()
	console.log('✅ Test database setup complete')
}
