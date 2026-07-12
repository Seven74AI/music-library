import { prisma } from '#app/utils/db.server'

export class ServiceNotFoundError extends Error {
	constructor(serviceName: string) {
		super(`Service not found: ${serviceName}`)
		this.name = 'ServiceNotFoundError'
	}
}

export async function getServiceByName(serviceName: string) {
	const service = await prisma.service.findUnique({
		where: { name: serviceName },
	})

	if (!service) {
		throw new ServiceNotFoundError(serviceName)
	}

	return service
}
