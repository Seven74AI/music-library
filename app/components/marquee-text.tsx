import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '#app/utils/misc'

interface MarqueeTextProps {
	children: ReactNode
	className?: string
}

/**
 * Renders text that scrolls horizontally when it overflows its container.
 * Measures overflow on mount and resize; static when text fits.
 */
export function MarqueeText({ children, className }: MarqueeTextProps) {
	const containerRef = useRef<HTMLDivElement>(null)
	const textRef = useRef<HTMLSpanElement>(null)
	const [overflows, setOverflows] = useState(false)
	const [distance, setDistance] = useState(0)

	useEffect(() => {
		const container = containerRef.current
		const text = textRef.current
		if (!container || !text) return

		const measure = () => {
			const overflow = text.scrollWidth - container.clientWidth
			setOverflows(overflow > 0)
			setDistance(overflow > 0 ? overflow : 0)
		}

		measure()

		const observer = new ResizeObserver(measure)
		observer.observe(container)
		observer.observe(text)

		return () => observer.disconnect()
	}, [children])

	return (
		<div
			ref={containerRef}
			className={cn('overflow-hidden whitespace-nowrap relative', className)}
		>
			{overflows ? (
				<span
					ref={textRef}
					className="inline-block animate-marquee"
					style={
						{ '--marquee-distance': `-${distance}px` } as React.CSSProperties
					}
				>
					{children}
				</span>
			) : (
				<span ref={textRef} className="inline-block truncate">
					{children}
				</span>
			)}
		</div>
	)
}
