import closeWithGrace from 'close-with-grace'
import { setupServer } from 'msw/node'
import { handlers as pwnedPasswordApiHandlers } from './pwned-passwords.ts'
import { handlers as resendHandlers } from './resend.ts'
import { handlers as tigrisHandlers } from './tigris.ts'

import { handlers as imageOptimizerHandlers } from './image-optimizer.ts'

export const server = setupServer(
	...resendHandlers,
	...tigrisHandlers,
	...pwnedPasswordApiHandlers,
	...imageOptimizerHandlers,
)

// Optimization: start the server only once
let serverStarted = false

if (!serverStarted) {
	server.listen({
		onUnhandledRequest(request, print) {
			// Do not print warnings on unhandled requests to https://<:userId>.ingest.us.sentry.io/api/
			// Note: a request handler with passthrough is not suited with this type of url
			//       until there is a more permissible url catching system
			//       like requested at https://github.com/mswjs/msw/issues/1804
			if (request.url.includes('.sentry.io')) {
				return
			}
			// React-router-devtools send custom requests internally to handle some functionality, we ignore those
			if (request.url.includes('__rrdt')) {
				return
			}
			// Print the regular MSW unhandled request warning otherwise.
			print.warning()
		},
	})
	serverStarted = true
}

if (process.env.MOCKS === 'true') {
	console.info('🔶 Mock server installed')
	console.info('🔶 MSW server started')

	// Only register close-with-grace outside vitest — in vitest, afterEach
	// cleanup in setup-test-env.ts handles server shutdown, and close-with-grace's
	// process.exit patching causes "process.exit unexpectedly called" worker crashes
	// when the vitest worker pool cycles.
	if (!process.env.VITEST) {
		closeWithGrace(() => {
			server.close()
		})
	}
}
