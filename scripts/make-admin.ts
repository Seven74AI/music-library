#!/usr/bin/env tsx
/**
 * Make a user an admin by username
 * 
 * Usage:
 *   Local:   tsx scripts/make-admin.ts <username>
 *   Fly.io: fly ssh console --app [APP_NAME] -C "cd /myapp && tsx scripts/make-admin.ts <username>"
 * 
 * Examples:
 *   tsx scripts/make-admin.ts kody
 *   tsx scripts/make-admin.ts myuser
 */

import 'dotenv/config'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { getDatabaseUrl } from '#app/utils/database-url.server.ts'
import { PrismaClient } from '#prisma/client.js'

// Create Prisma Client using the same pattern as seed.ts
const adapter = new PrismaBetterSqlite3({
	url: getDatabaseUrl(),
})

const prisma = new PrismaClient({ adapter })

async function makeAdmin(username: string) {
	try {
		console.log(`🔍 Looking for user: ${username}`)

		// Check if user exists
		const user = await prisma.user.findUnique({
			where: { username },
			select: {
				id: true,
				username: true,
				email: true,
				roles: {
					select: {
						name: true,
					},
				},
			},
		})

		if (!user) {
			console.error(`❌ User "${username}" not found`)
			process.exit(1)
		}

		// Check if user is already an admin
		const isAdmin = user.roles.some((role) => role.name === 'admin')
		if (isAdmin) {
			console.log(`✅ User "${username}" is already an admin`)
			console.log(`   Email: ${user.email}`)
			console.log(`   Roles: ${user.roles.map((r) => r.name).join(', ')}`)
			await prisma.$disconnect()
			return
		}

		// Check if admin role exists
		const adminRole = await prisma.role.findUnique({
			where: { name: 'admin' },
		})

		if (!adminRole) {
			console.error(`❌ Admin role not found in database`)
			console.error(`   Please ensure the database has been seeded with roles`)
			process.exit(1)
		}

		// Add admin role to user (without removing existing roles)
		console.log(`👑 Adding admin role to user "${username}"...`)
		await prisma.user.update({
			where: { username },
			data: {
				roles: {
					connect: { name: 'admin' },
				},
			},
		})

		// Verify the update
		const updatedUser = await prisma.user.findUnique({
			where: { username },
			select: {
				username: true,
				email: true,
				roles: {
					select: {
						name: true,
					},
				},
			},
		})

		console.log(`✅ Successfully made "${username}" an admin!`)
		console.log(`   Email: ${updatedUser?.email}`)
		console.log(`   Roles: ${updatedUser?.roles.map((r) => r.name).join(', ')}`)
	} catch (error) {
		console.error('❌ Error making user admin:', error)
		process.exit(1)
	} finally {
		await prisma.$disconnect()
	}
}

// Get username from command line arguments
const username = process.argv[2]

if (!username) {
	console.error('❌ Error: Username is required')
	console.log('\nUsage:')
	console.log('  tsx scripts/make-admin.ts <username>')
	console.log('\nExamples:')
	console.log('  tsx scripts/make-admin.ts kody')
	console.log('  tsx scripts/make-admin.ts myuser')
	console.log('\nFor production (Fly.io):')
	console.log('  fly ssh console --app [APP_NAME] -C "cd /myapp && tsx scripts/make-admin.ts <username>"')
	process.exit(1)
}

await makeAdmin(username)

