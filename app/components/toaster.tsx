import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { ToastAction } from '#app/components/ui/toast.tsx'
import { toast as showToast } from '#app/components/ui/use-toast.ts'
import { type Toast } from '#app/utils/toast.server.ts'

export function useToast(toast?: Toast | null) {
	const navigate = useNavigate()
	const [mounted, setMounted] = useState(false)
	
	// Ensure component is mounted before showing toast to prevent hydration mismatch
	useEffect(() => {
		setMounted(true)
	}, [])
	
	useEffect(() => {
		if (toast && mounted) {
			// Use requestAnimationFrame instead of setTimeout to ensure proper timing
			requestAnimationFrame(() => {
				const toastOptions: any = {
					title: toast.title,
					description: toast.description,
					variant: toast.type === 'error' ? 'destructive' : 'default',
				}

				// Durée personnalisée
				if (toast.duration) {
					toastOptions.duration = toast.duration
				}

				// Action personnalisée
				if (toast.action) {
					toastOptions.action = (
						<ToastAction
							altText={toast.action.label}
							onClick={() => {
								if (toast.action?.href) {
									void navigate(toast.action.href)
								} else if (toast.action?.onClick) {
									// Appeler une fonction personnalisée
									;(window as any)[toast.action.onClick]?.()
								}
							}}
						>
							{toast.action.label}
						</ToastAction>
					)
				}

				showToast(toastOptions)
			})
		}
	}, [toast, navigate, mounted])
}
