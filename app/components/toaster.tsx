import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast as showToast } from 'sonner'
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
					id: toast.id,
					description: toast.description,
				}

				// Durée personnalisée
				if (toast.duration) {
					toastOptions.duration = toast.duration
				}

				// Action personnalisée
				if (toast.action) {
					toastOptions.action = {
						label: toast.action.label,
						onClick: () => {
							if (toast.action?.href) {
								void navigate(toast.action.href)
							} else if (toast.action?.onClick) {
								// Appeler une fonction personnalisée
								;(window as any)[toast.action.onClick]?.()
							}
						}
					}
				}

				showToast[toast.type](toast.title, toastOptions)
			})
		}
	}, [toast, navigate, mounted])
}
