import { startTransition } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { HydratedRouter } from 'react-router/dom'
import { registerServiceWorker } from './utils/pwa-register.client.ts'

registerServiceWorker()

startTransition(() => {
	hydrateRoot(document, <HydratedRouter />)
})
