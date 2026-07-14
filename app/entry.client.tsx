import { startTransition } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { HydratedRouter } from 'react-router/dom'
import * as Sentry from '@sentry/react-router'
import { registerServiceWorker } from './utils/pwa-register.client.ts'

registerServiceWorker()

// Sentry client-side monitoring — stripped at build time when SENTRY_DSN is not set
if (ENV.MODE === 'production' && ENV.SENTRY_DSN) {
	Sentry.init({
		dsn: ENV.SENTRY_DSN,
		integrations: [
			Sentry.captureConsoleIntegration({ levels: ['error'] }),
			Sentry.reactRouterTracingIntegration(),
			Sentry.replayIntegration(),
			Sentry.feedbackIntegration({ colorScheme: 'system' }),
		],
		tracesSampleRate: 1.0,
		replaysSessionSampleRate: 0.1,
		replaysOnErrorSampleRate: 1.0,
	})
}

const isOfflineShell = document.documentElement.dataset.offlineShell === 'true'

if (isOfflineShell) {
	createRoot(document).render(<HydratedRouter />)
} else {
	startTransition(() => {
		hydrateRoot(document, <HydratedRouter />)
	})
}
