// import { createCookieSessionStorage } from 'react-router'
import { type ProviderName } from './connections.tsx'
import { type AuthProvider } from './providers/provider.ts'
import { type Timings } from './timing.server.ts'

// Placeholder provider that throws an error when used
class PlaceholderProvider implements AuthProvider {
	getAuthStrategy() {
		return null
	}

	async resolveConnectionData(
		_providerId: string,
		_options?: { timings?: Timings },
	): Promise<{ displayName: string; link?: string | null }> {
		throw new Error('No external providers configured')
	}

	async handleMockAction(_request: Request): Promise<void> {
		throw new Error('No external providers configured')
	}
}

export const providers: Record<ProviderName, AuthProvider> = {
	placeholder: new PlaceholderProvider(),
}

export function handleMockAction(providerName: ProviderName, request: Request) {
	const provider = providers[providerName]
	if (!provider) {
		throw new Error(`Provider ${providerName} not found`)
	}
	return provider.handleMockAction(request)
}

export function resolveConnectionData(
	providerName: ProviderName,
	providerId: string,
	options?: { timings?: Timings },
) {
	const provider = providers[providerName]
	if (!provider) {
		throw new Error(`Provider ${providerName} not found`)
	}
	return provider.resolveConnectionData(providerId, options)
}
