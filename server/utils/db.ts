import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { getDatabaseUrl } from '#app/utils/database-url.server.ts'
import { PrismaClient } from '#prisma/client.js'

// Simple singleton - no hot reload needed in production workers
let prismaInstance: PrismaClient | null = null

/**
 * Get or create a Prisma client instance
 * Uses singleton pattern for production worker environment
 * @returns PrismaClient instance
 */
export function getPrisma(): PrismaClient {
  if (!prismaInstance) {
    const adapter = new PrismaBetterSqlite3({
      url: getDatabaseUrl(),
    })
    prismaInstance = new PrismaClient({
      adapter,
      log: [
        { level: 'error', emit: 'stdout' },
        { level: 'warn', emit: 'stdout' },
      ],
    })
    void prismaInstance.$connect()
  }
  return prismaInstance
}

export const prisma = getPrisma()
