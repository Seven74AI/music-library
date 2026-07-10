import { useCallback, useEffect, useState } from 'react'
import {
	dismissInstallPrompt,
	isAndroidDevice,
	isIosSafari,
	isStandaloneDisplayMode,
	readInstallPromptDismissed,
	shouldShowInstallPrompt,
} from '#app/utils/pwa-install.client.ts'

type BeforeInstallPromptEvent = Event & {
	prompt: () => Promise<void>
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function usePwaInstall() {
	const [visible, setVisible] = useState(false)
	const [deferredPrompt, setDeferredPrompt] =
		useState<BeforeInstallPromptEvent | null>(null)
	const [isIos, setIsIos] = useState(false)
	const [isAndroid, setIsAndroid] = useState(false)

	useEffect(() => {
		const ua = navigator.userAgent
		setIsIos(isIosSafari(ua))
		setIsAndroid(isAndroidDevice(ua))

		const updateVisibility = () => {
			setVisible(
				shouldShowInstallPrompt({
					isStandalone: isStandaloneDisplayMode(),
					dismissed: readInstallPromptDismissed(),
				}),
			)
		}

		updateVisibility()

		const onBeforeInstallPrompt = (event: Event) => {
			event.preventDefault()
			setDeferredPrompt(event as BeforeInstallPromptEvent)
			updateVisibility()
		}

		const onAppInstalled = () => {
			setDeferredPrompt(null)
			setVisible(false)
		}

		window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
		window.addEventListener('appinstalled', onAppInstalled)

		return () => {
			window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
			window.removeEventListener('appinstalled', onAppInstalled)
		}
	}, [])

	const dismiss = useCallback(() => {
		dismissInstallPrompt()
		setVisible(false)
	}, [])

	const install = useCallback(async () => {
		if (!deferredPrompt) return false

		await deferredPrompt.prompt()
		const { outcome } = await deferredPrompt.userChoice
		setDeferredPrompt(null)

		if (outcome === 'accepted') {
			setVisible(false)
			return true
		}

		return false
	}, [deferredPrompt])

	const canInstallNatively = Boolean(deferredPrompt)

	return {
		visible,
		dismiss,
		install,
		isIos,
		isAndroid,
		canInstallNatively,
	}
}
