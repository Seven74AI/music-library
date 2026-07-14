import * as Sentry from '@sentry/react-router'
import { nodeProfilingIntegration } from '@sentry/profiling-node'

Sentry.init({
	dsn: process.env.SENTRY_DSN,
	integrations: [
		Sentry.captureConsoleIntegration({ levels: ['error'] }),
		nodeProfilingIntegration(),
	],
	// Performance Monitoring
	tracesSampleRate: 1.0,
	profilesSampleRate: 1.0,
})
