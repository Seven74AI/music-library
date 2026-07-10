import { default as defaultConfig } from '@epic-web/config/eslint'

/** @type {import("eslint").Linter.Config} */
export default [
	...defaultConfig,
	// add custom config objects here:
	{
		files: ['**/tests/**/*.ts'],
		rules: { 'react-hooks/rules-of-hooks': 'off' },
	},
	{
		ignores: [
			'.react-router/*',
			'generated/**/*',
			'app/pwa/**',
			'app/features/offline-storage/opfs.worker.ts',
			'public/sw.js',
			'.tmp/**',
		],
	},
]
