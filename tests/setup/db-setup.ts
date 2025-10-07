import path from 'node:path'
import fsExtra from 'fs-extra'
import { afterAll, beforeEach } from 'vitest'
import { BASE_DATABASE_PATH } from './global-setup.ts'

const databaseFile = `./tests/prisma/data.${process.env.VITEST_POOL_ID || 0}.db`
const databasePath = path.join(process.cwd(), databaseFile)
process.env.DATABASE_URL = `file:${databasePath}`

// Cache to avoid unnecessary copies
let lastBaseDbModified: number | null = null

beforeEach(async () => {
	const baseDbStats = await fsExtra.stat(BASE_DATABASE_PATH)
	const currentModified = baseDbStats.mtime.getTime()
	
	// Only copy if the database has changed
	if (lastBaseDbModified !== currentModified) {
		await fsExtra.copyFile(BASE_DATABASE_PATH, databasePath)
		lastBaseDbModified = currentModified
	}
})

afterAll(async () => {
	// we *must* use dynamic imports here so the process.env.DATABASE_URL is set
	// before prisma is imported and initialized
	const { prisma } = await import('#app/utils/db.server.ts')
	await prisma.$disconnect()
	await fsExtra.remove(databasePath)
})
