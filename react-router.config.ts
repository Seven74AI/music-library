import { type Config } from '@react-router/dev/config'

export default {
	// Defaults to true. Set to false to enable SPA for all routes.
	ssr: true,

	routeDiscovery: { mode: 'lazy' },

	future: {
		"v8_middleware": true,
		"unstable_optimizeDeps": true,
		"v8_splitRouteModules": true,
		"v8_viteEnvironmentApi": true,
	},
} satisfies Config
