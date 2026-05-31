import { type Config } from '@react-router/dev/config'

export default {
	// Defaults to true. Set to false to enable SPA for all routes.
	ssr: true,

	routeDiscovery: { mode: 'lazy' },

	future: {
		unstable_optimizeDeps: true,
		v8_splitRouteModules: true,
	},
} satisfies Config
