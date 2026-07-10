/// <reference lib="webworker" />

import { installSerwist } from 'serwist/legacy'

declare const self: ServiceWorkerGlobalScope & {
	__SW_MANIFEST: Array<{ url: string; revision: string | null }>
}

installSerwist({
	precacheEntries: self.__SW_MANIFEST,
	skipWaiting: true,
	clientsClaim: true,
	navigationPreload: true,
	navigateFallback: '/index.html',
	navigateFallbackDenylist: [
		/^\/resources\//,
		/^\/api\//,
		/\.data$/,
	],
})
