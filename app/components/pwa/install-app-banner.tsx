import { usePwaInstall } from '#app/hooks/use-pwa-install.ts'
import { InstallAppPrompt } from './install-app-prompt.tsx'

type InstallAppBannerProps = {
	playerVisible: boolean
}

export function InstallAppBanner({ playerVisible }: InstallAppBannerProps) {
	const { visible, dismiss, install, isIos, canInstallNatively } = usePwaInstall()

	if (!visible) return null

	return (
		<div
			className="fixed left-0 right-0 z-30"
			style={{ bottom: playerVisible ? '4.5rem' : '0' }}
		>
			<InstallAppPrompt
				layout="banner"
				isIos={isIos}
				canInstallNatively={canInstallNatively}
				onInstall={() => void install()}
				onDismiss={dismiss}
			/>
		</div>
	)
}
