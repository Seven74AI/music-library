import { startTransition } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { HydratedRouter } from 'react-router/dom'
import { registerServiceWorker } from './utils/pwa-register.client.ts'

registerServiceWorker()

const isOfflineShell = document.documentElement.dataset.offlineShell === 'true'

if (isOfflineShell) {
	createRoot(document).render(<HydratedRouter />)
} else {
	startTransition(() => {
		hydrateRoot(document, <HydratedRouter />)
	})
}
