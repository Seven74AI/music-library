type OfflineClientLoaderArgs = {
	serverLoader: () => Promise<unknown>
	params: Record<string, string | undefined>
	request: Request
}

type OfflineClientLoaderFn<TOnline, TOffline> = (
	args: OfflineClientLoaderArgs,
) => Promise<TOnline | TOffline>

/**
 * Defer createOfflineClientLoader until clientLoader runs.
 * Route modules are evaluated during SSR build; calling .client.ts helpers at
 * module top level breaks because client-only exports are stubbed on the server.
 */
export function defineOfflineClientLoader<TOnline, TOffline>(routeId: string) {
	let cachedLoader: OfflineClientLoaderFn<TOnline, TOffline> | undefined

	async function clientLoader(
		args: OfflineClientLoaderArgs,
	): Promise<TOnline | TOffline> {
		if (!cachedLoader) {
			const { createOfflineClientLoader } = await import(
				'#app/features/offline-app/offline-loader.client.ts'
			)
			cachedLoader = createOfflineClientLoader<TOnline, TOffline>(routeId)
		}
		return cachedLoader(args)
	}

	clientLoader.hydrate = true as const
	return clientLoader
}

export function defineDeviceOnlyClientLoader<TOffline>(routeId: string) {
	let cachedLoader: (() => Promise<TOffline>) | undefined

	async function clientLoader(): Promise<TOffline> {
		if (!cachedLoader) {
			const { createDeviceOnlyClientLoader } = await import(
				'#app/features/offline-app/offline-loader.client.ts'
			)
			cachedLoader = createDeviceOnlyClientLoader<TOffline>(routeId)
		}
		return cachedLoader()
	}

	clientLoader.hydrate = true as const
	return clientLoader
}
