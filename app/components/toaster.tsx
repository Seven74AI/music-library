import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { ToastAction } from '#app/components/ui/toast.tsx'
import { toast as showToast } from '#app/components/ui/use-toast.ts'
import { type Toast } from '#app/utils/toast.server.ts'

/**
 * Available toast variants for different message types
 */
type ToastVariant = "default" | "success" | "destructive" | "error"

/**
 * Custom hook for handling server-side toast notifications
 * Converts server toast types to client-side toast variants
 * Handles navigation and global function calls for toast actions
 * 
 * @param toast - Server-side toast data from React Router loader
 * @returns void - Side effect hook that displays toasts
 */
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
				const getVariant = (type: Toast['type']): ToastVariant => {
					switch (type) {
						case 'error':
							return 'error'
						case 'success':
							return 'success'
						case 'destructive':
							return 'destructive'
						default:
							return 'default'
					}
				}

				const toastOptions: Parameters<typeof showToast>[0] = {
					title: toast.title,
					description: toast.description,
					variant: getVariant(toast.type),
				}

				// Custom duration
				if (toast.duration) {
					toastOptions.duration = toast.duration
				}

				// Custom action
				if (toast.action) {
					toastOptions.action = (
						<ToastAction
							altText={toast.action.label}
							onClick={() => {
								if (toast.action?.href) {
									void navigate(toast.action.href)
								} else if (toast.action?.onClick) {
									// Safer global function access
									const globalFunction = (window as unknown as Record<string, unknown>)[toast.action.onClick]
									if (typeof globalFunction === 'function') {
										globalFunction()
									}
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
