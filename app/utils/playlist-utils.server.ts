import { prisma } from '#app/utils/db.server'

/**
 * Error class for when a service is not found in the database.
 */
export class ServiceNotFoundError extends Error {
  constructor(serviceName: string) {
    super(`Service not found: ${serviceName}`)
    this.name = 'ServiceNotFoundError'
  }
}

/**
 * Get service by name with error handling.
 * Pure utility — no YouTube-specific logic.
 *
 * @param serviceName - The name of the service to retrieve
 * @returns Promise resolving to the service record
 * @throws ServiceNotFoundError if service doesn't exist
 */
export async function getServiceByName(serviceName: string) {
  const service = await prisma.service.findUnique({
    where: { name: serviceName },
  })

  if (!service) {
    throw new ServiceNotFoundError(serviceName)
  }

  return service
}
