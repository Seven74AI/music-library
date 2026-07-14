import { useEffect } from 'react'
import { ToastAction } from '#app/components/ui/toast.tsx'
import { toast } from '#app/components/ui/use-toast.ts'
import {
	activateServiceWorkerUpdate,
	onServiceWorkerUpdate,
} from '#app/utils/pwa-register.client.ts'

/**
 * Shows a toast when a new service worker version is detected.
 * The user clicks "Reload" to activate the update.
 */
export function useServiceWorkerUpdateToast() {
	useEffect(() => {
		onServiceWorkerUpdate(() => {
			toast({
				title: 'Update available',
				description: 'A new version is ready. Reload to update.',
				action: <ToastAction altText="Reload" onClick={activateServiceWorkerUpdate}>Reload</ToastAction>,
				duration: Infinity, // Don't auto-dismiss — user must act
			})
		})
	}, [])
}
