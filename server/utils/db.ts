import { PrismaClient } from '@prisma/client'

// Simple singleton - no hot reload needed in production workers
let prismaInstance: PrismaClient | null = null

/**
 * Get or create a Prisma client instance
 * Uses singleton pattern for production worker environment
 * @returns PrismaClient instance
 */
export function getPrisma(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient({
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
