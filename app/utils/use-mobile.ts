import { useEffect, useState } from 'react'

/**
 * Hook to detect if the user is on a mobile device
 * Uses media query to check if screen width is below 768px (md breakpoint)
 * Automatically updates when screen size changes
 * 
 * @returns boolean indicating if user is on mobile
 * @example
 * ```tsx
 * function MyComponent() {
 *   const isMobile = useIsMobile()
 *   
 *   return isMobile ? <MobileView /> : <DesktopView />
 * }
 * ```
 */
export function useIsMobile() {
	const [isMobile, setIsMobile] = useState(false)

	useEffect(() => {
		const checkMobile = () => {
			setIsMobile(window.matchMedia('(max-width: 768px)').matches)
		}

		checkMobile()
		const mediaQuery = window.matchMedia('(max-width: 768px)')
		mediaQuery.addEventListener('change', checkMobile)

		return () => mediaQuery.removeEventListener('change', checkMobile)
	}, [])

	return isMobile
}

