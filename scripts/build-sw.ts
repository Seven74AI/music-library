import fs from 'node:fs/promises'
import path from 'node:path'
import { injectManifest } from '@serwist/build'
import * as esbuild from 'esbuild'

const isDev = process.argv.includes('--dev')
const root = process.cwd()
const swEntry = path.join(root, 'app/pwa/sw.ts')
const tmpDir = path.join(root, '.tmp/pwa')
const bundledSw = path.join(tmpDir, 'sw.bundled.js')

async function bundleServiceWorker() {
	await fs.mkdir(tmpDir, { recursive: true })
	await esbuild.build({
		entryPoints: [swEntry],
		bundle: true,
		format: 'iife',
		target: 'es2022',
		outfile: bundledSw,
	})
}

async function buildDevServiceWorker() {
	await bundleServiceWorker()
	let code = await fs.readFile(bundledSw, 'utf8')
	if (!code.includes('self.__SW_MANIFEST')) {
		throw new Error('Service worker is missing self.__SW_MANIFEST injection point')
	}
	code = code.replace(/self\.__SW_MANIFEST/g, '[]')
	await fs.writeFile(path.join(root, 'public/sw.js'), code)
}

async function buildProdServiceWorker() {
	await bundleServiceWorker()
	const clientDir = path.join(root, 'build/client')
	const { count, size, warnings } = await injectManifest({
		swSrc: bundledSw,
		swDest: path.join(clientDir, 'sw.js'),
		globDirectory: clientDir,
		globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2,webmanifest}'],
		globIgnores: ['**/sw.js', '**/sw.bundled.js'],
		additionalPrecacheEntries: [{ url: '/index.html', revision: null }],
		maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
	})

	console.log(`Precached ${count} files (${size} bytes)`)
	for (const warning of warnings) {
		console.warn(warning)
	}
}

await (isDev ? buildDevServiceWorker() : buildProdServiceWorker())
