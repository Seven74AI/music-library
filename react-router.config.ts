import { type Config } from '@react-router/dev/config'

export default {
	// Defaults to true. Set to false to enable SPA for all routes.
	ssr: true,

	routeDiscovery: { mode: 'lazy' },

	// Split route modules for parallel loading (default in v8)
	splitRouteModules: true,
} satisfies Config
