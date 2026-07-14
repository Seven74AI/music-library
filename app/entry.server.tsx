import crypto from 'node:crypto'
import { PassThrough } from 'node:stream'
import { createReadableStreamFromReadable } from '@react-router/node'
import * as Sentry from '@sentry/react-router'
import { isbot } from 'isbot'
import { renderToPipeableStream } from 'react-dom/server'
import {
	ServerRouter,
	type HandleDocumentRequestFunction,
} from 'react-router'
import { createCSP } from './utils/csp.server.ts'
import { getEnv, init } from './utils/env.server.ts'
import { getInstanceInfo } from './utils/litefs.server.ts'
import { NonceProvider } from './utils/nonce-provider.ts'
import { getServerAppContext } from './utils/router-context.server.ts'
import { makeTimings } from './utils/timing.server.ts'

export const streamTimeout = 5000

init()
global.ENV = getEnv()

// Start the audio-archive worker if enabled.
// Runs as an in-process setInterval per ADR-011 — only on the LiteFS primary instance.
if (process.env.AUDIO_ARCHIVE_ENABLED === 'true') {
	const intervalMs = Number(process.env.AUDIO_ARCHIVE_INTERVAL_MS) || 120_000
	void import('./features/audio-archive/worker.server.ts').then(
		({ processQueueTick }) => {
			const runTick = async () => {
				const { currentIsPrimary } = await getInstanceInfo()
				if (!currentIsPrimary) return
				await processQueueTick()
			}

			void runTick()
			setInterval(runTick, intervalMs)
			console.log(`Audio archive worker started (interval: ${intervalMs}ms)`)
		},
	)
}

const MODE = process.env.NODE_ENV ?? 'development'

type DocRequestArgs = Parameters<HandleDocumentRequestFunction>

export default async function handleRequest(...args: DocRequestArgs) {
	const [request, responseStatusCode, responseHeaders, reactRouterContext, loadContext] =
		args
	const { currentInstance, primaryInstance } = await getInstanceInfo()
	responseHeaders.set('fly-region', process.env.FLY_REGION ?? 'unknown')
	responseHeaders.set('fly-app', process.env.FLY_APP_NAME ?? 'unknown')
	responseHeaders.set('fly-primary-instance', primaryInstance)
	responseHeaders.set('fly-instance', currentInstance)

	if (process.env.NODE_ENV === 'production') {
		responseHeaders.append('Document-Policy', 'js-profiling')
	}

	const nonce =
		getServerAppContext(loadContext)?.nonce ??
		crypto.randomBytes(16).toString('hex')

	const csp = createCSP(nonce, { isDev: MODE === 'development' })
	if (process.env.MOCKS === 'true') {
		responseHeaders.set('Content-Security-Policy-Report-Only', csp)
	} else {
		responseHeaders.set('Content-Security-Policy', csp)
	}

	const callbackName = isbot(request.headers.get('user-agent'))
		? 'onAllReady'
		: 'onShellReady'

	return new Promise(async (resolve, reject) => {
		let didError = false
		// NOTE: this timing will only include things that are rendered in the shell
		// and will not include suspended components and deferred loaders
		const timings = makeTimings('render', 'renderToPipeableStream')

		const { pipe, abort } = renderToPipeableStream(
			<NonceProvider value={nonce}>
				<ServerRouter
					nonce={nonce}
					context={reactRouterContext}
					url={request.url}
				/>
			</NonceProvider>,
			{
				[callbackName]: () => {
					const body = new PassThrough()
					responseHeaders.set('Content-Type', 'text/html')
					responseHeaders.append('Server-Timing', timings.toString())

				resolve(
						new Response(createReadableStreamFromReadable(body), {
							headers: responseHeaders,
							status: didError ? 500 : responseStatusCode,
						}),
					)
					pipe(body)
				},
				onShellError: (err: unknown) => {
					reject(err)
				},
				onError: () => {
					didError = true
				},
				nonce,
			},
		)

		setTimeout(abort, streamTimeout + 5000)
	})
}

export async function handleDataRequest(response: Response) {
	const { currentInstance, primaryInstance } = await getInstanceInfo()
	response.headers.set('fly-region', process.env.FLY_REGION ?? 'unknown')
	response.headers.set('fly-app', process.env.FLY_APP_NAME ?? 'unknown')
	response.headers.set('fly-primary-instance', primaryInstance)
	response.headers.set('fly-instance', currentInstance)

	return response
}

export const handleError = Sentry.createSentryHandleError({
	// React Router may log the error to console as well, we handle it ourselves
	logErrors: false,
})

// Auto-instruments all server loaders, actions, middleware, and lazy route loading.
export const instrumentations = [Sentry.createSentryServerInstrumentation()]
