/// <reference lib="webworker" />

const CACHE_VERSION = 'music-library-pwa-v1'

self.addEventListener('install', (event: ExtendableEvent) => {
	event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event: ExtendableEvent) => {
	event.waitUntil(self.clients.claim())
})

// Phase 1: minimal worker for installability. Phase 2 adds Workbox precaching here.
self.addEventListener('fetch', (event: FetchEvent) => {
	if (event.request.method !== 'GET') return
	event.respondWith(fetch(event.request))
})

void CACHE_VERSION
