const OFFLINE_ROOT_SHELL_KEY = 'music-library:offline-root-shell'

export type OfflineRootShell = {
	user: {
		id: string
		name: string | null
		username: string
		image: { objectKey: string } | null
		roles: Array<{
			name: string
			permissions: Array<{ entity: string; action: string; access: string }>
		}>
	} | null
	notifications: []
	unreadNotificationCount: number
	requestInfo: {
		hints: Record<string, string>
		origin: string
		path: string
		userPrefs: { theme: 'light' | 'dark' | null }
	}
	ENV: Record<string, string | undefined>
	toast: null
	honeyProps: Record<string, unknown>
	offlineShell: boolean
}

export function persistOfflineRootShell(data: {
	user: OfflineRootShell['user']
	requestInfo: OfflineRootShell['requestInfo']
	ENV: OfflineRootShell['ENV']
}) {
	if (typeof localStorage === 'undefined') return

	localStorage.setItem(
		OFFLINE_ROOT_SHELL_KEY,
		JSON.stringify({
			user: data.user,
			notifications: [],
			unreadNotificationCount: 0,
			requestInfo: data.requestInfo,
			ENV: data.ENV,
			toast: null,
			honeyProps: {},
			offlineShell: true,
		} satisfies OfflineRootShell),
	)
}

export function readOfflineRootShell(): OfflineRootShell | null {
	if (typeof localStorage === 'undefined') return null

	const raw = localStorage.getItem(OFFLINE_ROOT_SHELL_KEY)
	if (!raw) return null

	try {
		return JSON.parse(raw) as OfflineRootShell
	} catch {
		return null
	}
}

export function createFallbackOfflineRootShell(): OfflineRootShell {
	return {
		user: readOfflineRootShell()?.user ?? null,
		notifications: [],
		unreadNotificationCount: 0,
		requestInfo: {
			hints: {},
			origin: typeof window !== 'undefined' ? window.location.origin : '',
			path: typeof window !== 'undefined' ? window.location.pathname : '/',
			userPrefs: { theme: 'light' },
		},
		ENV: readOfflineRootShell()?.ENV ?? {},
		toast: null,
		honeyProps: {},
		offlineShell: true,
	}
}
