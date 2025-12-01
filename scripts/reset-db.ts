#!/usr/bin/env tsx
/**
 * Reset database (drop, recreate, and run migrations)
 * 
 * ⚠️  WARNING: This will DELETE ALL DATA in the database!
 * 
 * Usage:
 *   Local:   tsx scripts/reset-db.ts [--seed]
 *   Fly.io:  fly ssh console --app [APP_NAME] -C "cd /myapp && tsx scripts/reset-db.ts [--seed]"
 * 
 * Options:
 *   --seed    Run seed after reset (default: false)
 *   --force   Required flag to confirm you want to reset
 * 
 * Examples:
 *   tsx scripts/reset-db.ts --force
 *   tsx scripts/reset-db.ts --force --seed
 */

import 'dotenv/config'
import { execSync } from 'node:child_process'
import { getDatabaseUrl } from '#app/utils/database-url.server.ts'

// Parse command line arguments
const args = process.argv.slice(2)
const shouldSeed = args.includes('--seed')
const force = args.includes('--force')

// Check if running in production
const isProduction = process.env.NODE_ENV === 'production'
const isFly = process.env.FLY === 'true'

function resetDatabase() {
	const databaseUrl = getDatabaseUrl()
	
	// Safety check: require --force flag
	if (!force) {
		console.error('❌ ERROR: --force flag is required')
		console.error('   This is a safety measure to prevent accidental data loss.')
		console.error('')
		console.error('Usage:')
		console.error('  tsx scripts/reset-db.ts --force')
		console.error('  tsx scripts/reset-db.ts --force --seed')
		process.exit(1)
	}

	// Additional safety check for production
	if ((isProduction || isFly) && !force) {
		console.error('❌ ERROR: Database reset requires --force flag in production')
		process.exit(1)
	}

	console.log('⚠️  WARNING: This will DELETE ALL DATA in the database!')
	console.log(`   Database: ${databaseUrl}`)
	console.log('')
	console.log('This operation will:')
	console.log('  1. Drop all tables')
	console.log('  2. Recreate the database schema')
	console.log('  3. Run all migrations')
	if (shouldSeed) {
		console.log('  4. Run seed script')
	}
	console.log('')

	try {
		// Run Prisma migrate reset
		console.log('📦 Running: npx prisma migrate reset --force')
		execSync('npx prisma migrate reset --force', {
			stdio: 'inherit',
			env: {
				...process.env,
				DATABASE_URL: databaseUrl,
			},
		})

		// Run seed if requested (prisma migrate reset already runs seed by default,
		// but we can run it again if explicitly requested)
		if (shouldSeed) {
			console.log('')
			console.log('🌱 Running seed...')
			execSync('npx prisma db seed', {
				stdio: 'inherit',
				env: {
					...process.env,
					DATABASE_URL: databaseUrl,
				},
			})
		}

		console.log('')
		console.log('✅ Database reset completed successfully!')
	} catch (error) {
		console.error('❌ Error resetting database:', error)
		process.exit(1)
	}
}

resetDatabase()

