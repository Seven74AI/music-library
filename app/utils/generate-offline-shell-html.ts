/**
 * Build a static HTML shell for PWA offline cold start.
 *
 * React Router 7 SSR builds do not emit index.html into build/client, but the
 * service worker navigateFallback expects /index.html to exist in precache.
 */

export type OfflineShellAssets = {
	manifestScript?: string
	entryClient: string
	stylesheet?: string
	sprite?: string
}

export const OFFLINE_SHELL_ENV_BOOTSTRAP = `try {
  var shell = localStorage.getItem('music-library:offline-root-shell');
  window.ENV = shell ? (JSON.parse(shell).ENV || {}) : {};
} catch {
  window.ENV = {};
}`

export const OFFLINE_SHELL_ROUTER_CONTEXT_BOOTSTRAP = `window.__reactRouterContext = ${JSON.stringify(
	{
		basename: '/',
		future: {
			unstable_optimizeDeps: true,
			v8_passThroughRequests: false,
			v8_trailingSlashAwareDataRequests: false,
			unstable_previewServerPrerendering: false,
			v8_middleware: true,
			v8_splitRouteModules: true,
			v8_viteEnvironmentApi: false,
		},
		routeDiscovery: { mode: 'lazy' },
		ssr: true,
		isSpaMode: false,
	},
)};
window.__reactRouterContext.stream = new ReadableStream({
  start(controller) {
    controller.close();
  },
}).pipeThrough(new TextEncoderStream());`

export function generateOfflineShellHtml(assets: OfflineShellAssets): string {
	const lines = [
		'<!DOCTYPE html>',
		'<html lang="en" class="light h-full overflow-x-hidden" data-offline-shell="true">',
		'<head>',
		'  <meta charset="utf-8" />',
		'  <meta name="viewport" content="width=device-width,initial-scale=1" />',
		'  <title>Music Library</title>',
	]

	if (assets.sprite) {
		lines.push(
			`  <link rel="preload" href="${assets.sprite}" as="image/svg+xml" fetchpriority="high" />`,
		)
	}

	lines.push('  <link rel="icon" href="/favicon.ico" sizes="48x48" />')
	lines.push(
		'  <link rel="manifest" href="/site.webmanifest" crossorigin="use-credentials" />',
	)

	if (assets.stylesheet) {
		lines.push(`  <link rel="stylesheet" href="${assets.stylesheet}" />`)
	}

	lines.push(
		'</head>',
		'<body class="bg-background text-foreground">',
		`  <script>${OFFLINE_SHELL_ENV_BOOTSTRAP}</script>`,
		`  <script>${OFFLINE_SHELL_ROUTER_CONTEXT_BOOTSTRAP}</script>`,
	)

	if (assets.manifestScript) {
		lines.push(`  <script src="${assets.manifestScript}"></script>`)
	}

	lines.push(
		`  <script type="module">import("${assets.entryClient}");</script>`,
		'</body>',
		'</html>',
	)

	return `${lines.join('\n')}\n`
}

export function findOfflineShellAssets(
	assetFileNames: string[],
): OfflineShellAssets {
	const find = (prefix: string, ext: string) => {
		const file = assetFileNames.find(
			(name) => name.startsWith(prefix) && name.endsWith(ext),
		)
		if (!file) {
			throw new Error(`Missing offline shell asset: ${prefix}*.${ext}`)
		}
		return `/assets/${file}`
	}

	return {
		manifestScript: find('manifest-', '.js'),
		entryClient: find('entry.client-', '.js'),
		stylesheet: assetFileNames.some(
			(name) => name.startsWith('tailwind-') && name.endsWith('.css'),
		)
			? find('tailwind-', '.css')
			: undefined,
		sprite: assetFileNames.some(
			(name) => name.startsWith('sprite-') && name.endsWith('.svg'),
		)
			? find('sprite-', '.svg')
			: undefined,
	}
}
