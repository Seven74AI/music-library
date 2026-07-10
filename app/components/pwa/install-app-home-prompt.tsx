import { usePwaInstall } from '#app/hooks/use-pwa-install.ts'
import { InstallAppPrompt } from './install-app-prompt.tsx'

export function InstallAppHomePrompt() {
	const { visible, dismiss, install, isIos, canInstallNatively } = usePwaInstall()

	if (!visible) return null

	return (
		<div className="mb-8">
			<InstallAppPrompt
				layout="card"
				isIos={isIos}
				canInstallNatively={canInstallNatively}
				onInstall={() => void install()}
				onDismiss={dismiss}
			/>
		</div>
	)
}
