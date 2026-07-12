import {
	isRouteErrorResponse,
	redirect,
	type DataStrategyResult,
	type MiddlewareFunction,
} from 'react-router'
import { isOfflineEnvironment } from '#app/features/offline-app/is-offline-environment.client.ts'
import {
	getOfflineRedirectTarget,
	resolveOfflineStubForRoute,
	shouldSkipOfflineMiddlewareRoute,
} from '#app/features/offline-app/offline-route-policies.client.ts'

export function shouldSubstituteOfflineResult(result: DataStrategyResult | undefined) {
	if (!result) return true
	if (result.type === 'data') return false
	if (isRouteErrorResponse(result.result)) return false
	return true
}

export function patchOfflineDataStrategyResults(
	results: Record<string, DataStrategyResult>,
	request: Request,
) {
	const patched: Record<string, DataStrategyResult> = { ...results }

	for (const [routeId, result] of Object.entries(results)) {
		if (shouldSkipOfflineMiddlewareRoute(routeId)) continue
		if (!shouldSubstituteOfflineResult(result)) continue

		patched[routeId] = {
			type: 'data',
			result: resolveOfflineStubForRoute(routeId, request),
		}
	}

	return patched
}

export const offlineClientMiddleware: MiddlewareFunction<
	Record<string, DataStrategyResult>
> = async ({ request }, next) => {
	if (isOfflineEnvironment()) {
		const redirectTo = getOfflineRedirectTarget(request)
		if (redirectTo) {
			throw redirect(redirectTo)
		}
	}

	const results = await next()

	if (!isOfflineEnvironment()) {
		return results
	}

	return patchOfflineDataStrategyResults(results, request)
}
