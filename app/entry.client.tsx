import { startTransition } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { HydratedRouter } from 'react-router/dom'
import * as Sentry from '@sentry/react-router'
import { registerServiceWorker } from './utils/pwa-register.client.ts'

registerServiceWorker()

// Sentry client-side monitoring — gated on ENV.MODE + ENV.SENTRY_DSN at runtime
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

// Recover from hydration failures where turbo-stream decoding throws
// an unhandled SyntaxError (e.g. corrupted streaming response). Sentry
// captures the error; we reload so the user gets a working page.
{
	const RELOAD_KEY = '__hermes_hydration_reload'
	window.addEventListener('error', (event) => {
		if (
			event.error instanceof SyntaxError &&
			!event.error.message &&
			sessionStorage.getItem(RELOAD_KEY) !== '1'
		) {
			sessionStorage.setItem(RELOAD_KEY, '1')
			// Brief delay so Sentry's global error handler fires first
			setTimeout(() => window.location.reload(), 100)
		}
	})
}
