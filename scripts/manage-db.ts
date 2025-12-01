#!/usr/bin/env tsx
/**
 * Production Database Management Script
 * 
 * Usage:
 *   tsx scripts/manage-db.ts <command> [options]
 * 
 * Commands:
 *   backup    - Create a backup of the database
 *   status    - Check database status and health
 *   query     - Run a SQL query
 *   vacuum    - Optimize database (VACUUM)
 *   analyze   - Update query statistics (ANALYZE)
 *   integrity - Check database integrity
 * 
 * Examples:
 *   tsx scripts/manage-db.ts backup
 *   tsx scripts/manage-db.ts query "SELECT COUNT(*) FROM Track"
 *   tsx scripts/manage-db.ts status
 */

import { execSync } from 'node:child_process'

const APP_NAME = process.env.FLY_APP_NAME || process.argv[3] || 'your-app-name'

function flyCommand(command: string): string {
	return `fly ssh console --app ${APP_NAME} -C "${command}"`
}

function executeFlyCommand(command: string): void {
	try {
		const result = execSync(flyCommand(command), { encoding: 'utf-8', stdio: 'inherit' })
		console.log(result)
	} catch (error) {
		console.error('Error executing command:', error)
		process.exit(1)
	}
}

function getDatabasePath(): string {
	return process.env.DATABASE_PATH || '/litefs/data/sqlite.db'
}

const command = process.argv[2]

switch (command) {
	case 'backup': {
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
		const backupPath = `/tmp/backup-${timestamp}.db`
		const dbPath = getDatabasePath()
		
		console.log(`Creating backup: ${backupPath}`)
		executeFlyCommand(`cp ${dbPath} ${backupPath}`)
		console.log(`✅ Backup created: ${backupPath}`)
		console.log(`\nTo download: fly sftp shell --app ${APP_NAME}`)
		console.log(`Then: get ${backupPath} ./backup-${timestamp}.db`)
		break
	}

	case 'status': {
		console.log('📊 Database Status\n')
		
		// Database size
		console.log('Database Size:')
		executeFlyCommand(`ls -lh ${getDatabasePath()}`)
		
		// Integrity check
		console.log('\nIntegrity Check:')
		executeFlyCommand(`sqlite3 ${process.env.DATABASE_URL || `file:${getDatabasePath()}`} 'PRAGMA integrity_check;'`)
		
		// Table counts
		console.log('\nTable Counts:')
		const query = `
			SELECT 
				'Track' as table_name, COUNT(*) as count FROM Track
			UNION ALL
			SELECT 'User', COUNT(*) FROM User
			UNION ALL
			SELECT 'Playlist', COUNT(*) FROM Playlist
			UNION ALL
			SELECT 'ServicePlaylist', COUNT(*) FROM ServicePlaylist
			UNION ALL
			SELECT 'Artist', COUNT(*) FROM Artist
			UNION ALL
			SELECT 'Album', COUNT(*) FROM Album;
		`
		executeFlyCommand(`sqlite3 ${process.env.DATABASE_URL || `file:${getDatabasePath()}`} "${query}"`)
		break
	}

	case 'query': {
		const sqlQuery = process.argv[3]
		if (!sqlQuery) {
			console.error('Error: SQL query required')
			console.log('Usage: tsx scripts/manage-db.ts query "SELECT * FROM Track LIMIT 10"')
			process.exit(1)
		}
		
		console.log(`Running query: ${sqlQuery}\n`)
		executeFlyCommand(`sqlite3 ${process.env.DATABASE_URL || `file:${getDatabasePath()}`} "${sqlQuery}"`)
		break
	}

	case 'vacuum': {
		console.log('Running VACUUM (this may take a while)...')
		executeFlyCommand(`sqlite3 ${process.env.DATABASE_URL || `file:${getDatabasePath()}`} 'VACUUM;'`)
		console.log('✅ VACUUM completed')
		break
	}

	case 'analyze': {
		console.log('Running ANALYZE...')
		executeFlyCommand(`sqlite3 ${process.env.DATABASE_URL || `file:${getDatabasePath()}`} 'ANALYZE;'`)
		console.log('✅ ANALYZE completed')
		break
	}

	case 'integrity': {
		console.log('Checking database integrity...')
		executeFlyCommand(`sqlite3 ${process.env.DATABASE_URL || `file:${getDatabasePath()}`} 'PRAGMA integrity_check;'`)
		break
	}

	case 'migrate': {
		console.log('Running migrations...')
		executeFlyCommand('cd /myapp && npx prisma migrate deploy')
		console.log('✅ Migrations completed')
		break
	}

	default:
		console.log(`
Production Database Management Script

Usage:
  tsx scripts/manage-db.ts <command> [options]

Commands:
  backup              Create a backup of the database
  status              Check database status and health
  query <sql>         Run a SQL query
  vacuum              Optimize database (VACUUM)
  analyze             Update query statistics (ANALYZE)
  integrity           Check database integrity
  migrate             Run pending migrations

Examples:
  tsx scripts/manage-db.ts backup
  tsx scripts/manage-db.ts status
  tsx scripts/manage-db.ts query "SELECT COUNT(*) FROM Track"
  tsx scripts/manage-db.ts vacuum
  tsx scripts/manage-db.ts migrate

Environment Variables:
  FLY_APP_NAME        Fly.io app name (or pass as 3rd argument)
  DATABASE_URL        Database connection string
  DATABASE_PATH       Path to database file

Note: This script requires fly CLI to be installed and configured.
`)
		process.exit(1)
}

