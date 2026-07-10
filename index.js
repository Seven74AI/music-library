import 'dotenv/config'
import * as fs from 'node:fs'
import sourceMapSupport from 'source-map-support'

// Node 25 exposes a broken experimental localStorage; MSW needs a working Storage API.
await import('./tests/setup/local-storage-polyfill.ts')

sourceMapSupport.install({
	retrieveSourceMap: function (source) {
		// get source file without the `file://` prefix or `?t=...` suffix
		const match = source.match(/^file:\/\/(.*)\?t=[.\d]+$/)
		if (match) {
			return {
				url: source,
				map: fs.readFileSync(`${match[1]}.map`, 'utf8'),
			}
		}
		return null
	},
})

if (process.env.MOCKS === 'true') {
	await import('./tests/mocks/index.ts')
}

if (process.env.NODE_ENV === 'production') {
	await import('./server-build/index.js')
} else {
	await import('./server/index.ts')
}
