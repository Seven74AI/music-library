export const PWA_INSTALL_DISMISS_KEY = 'music-library:pwa-install-dismissed'

type StandaloneWindow = Pick<Window, 'matchMedia'> & {
	navigator: Navigator & { standalone?: boolean }
}

export function isStandaloneDisplayMode(windowLike: StandaloneWindow = window) {
	if (windowLike.matchMedia('(display-mode: standalone)').matches) {
		return true
	}

	return Boolean(windowLike.navigator.standalone)
}

export function isIosSafari(userAgent: string) {
	return /iPhone|iPad|iPod/i.test(userAgent) && !/CriOS|FxiOS|EdgiOS/i.test(userAgent)
}

export function isAndroidDevice(userAgent: string) {
	return /Android/i.test(userAgent)
}

export function readInstallPromptDismissed(storage: Pick<Storage, 'getItem'> = localStorage) {
	return storage.getItem(PWA_INSTALL_DISMISS_KEY) === 'true'
}

export function dismissInstallPrompt(storage: Pick<Storage, 'setItem'> = localStorage) {
	storage.setItem(PWA_INSTALL_DISMISS_KEY, 'true')
}

export function shouldShowInstallPrompt({
	isStandalone,
	dismissed,
}: {
	isStandalone: boolean
	dismissed: boolean
}) {
	return !isStandalone && !dismissed
}
