import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'

type InstallAppPromptProps = {
	layout: 'banner' | 'card'
	isIos: boolean
	canInstallNatively: boolean
	onInstall: () => void
	onDismiss: () => void
}

export function InstallAppPrompt({
	layout,
	isIos,
	canInstallNatively,
	onInstall,
	onDismiss,
}: InstallAppPromptProps) {
	const isBanner = layout === 'banner'

	return (
		<div
			className={
				isBanner
					? 'border-t border-border bg-muted/95 px-4 py-3 text-sm shadow-lg backdrop-blur-sm'
					: 'rounded-lg border border-border bg-muted/50 p-4 text-sm'
			}
			role="region"
			aria-label="Install app"
		>
			<div className="flex items-start gap-3">
				<Icon
					name="download"
					className="mt-0.5 h-5 w-5 shrink-0 text-primary"
					aria-hidden
				/>
				<div className="min-w-0 flex-1 space-y-2">
					<div>
						<p className="font-medium">Install Music Library</p>
						<p className="text-muted-foreground mt-1">
							{isIos
								? 'Tap Share, then Add to Home Screen for quick access and a full-screen experience.'
								: 'Add Music Library to your home screen for quick access and a full-screen experience.'}
						</p>
					</div>
					<div className="flex flex-wrap gap-2">
						{canInstallNatively ? (
							<Button size="sm" onClick={onInstall}>
								Install app
							</Button>
						) : null}
						<Button size="sm" variant="ghost" onClick={onDismiss}>
							Not now
						</Button>
					</div>
				</div>
			</div>
		</div>
	)
}
