import { useState } from 'react'
import { NavLink } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Card, CardContent } from '#app/components/ui/card.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { formatDuration } from '#app/utils/format-duration.ts'
import { cn } from '#app/utils/misc.tsx'
import { useIsMobile } from '#app/utils/use-mobile.ts'
import { PlaylistCover } from './playlist-cover'

interface Track {
	id: string
	title: string
	artist: string
	duration: number | null
	thumbnailUrl: string | null
}

interface PlaylistCardProps {
	id: string
	title: string
	description: string | null
	tracks: Track[]
	createdAt: string
	updatedAt: string
	className?: string
}

// Generate a gradient color based on playlist title
function getGradientFromTitle(title: string): string {
	const colors: string[] = [
		'from-blue-500 to-purple-600',
		'from-green-500 to-blue-600', 
		'from-purple-500 to-pink-600',
		'from-orange-500 to-red-600',
		'from-teal-500 to-blue-600',
		'from-pink-500 to-purple-600',
		'from-indigo-500 to-purple-600',
		'from-emerald-500 to-teal-600'
	]
	
	const hash = title.split('').reduce((a, b) => {
		a = ((a << 5) - a) + b.charCodeAt(0)
		return a & a
	}, 0)
	
	const index = Math.abs(hash) % colors.length
	return colors[index]!
}

export function PlaylistCard({ 
	id, 
	title, 
	description, 
	tracks, 
	createdAt, 
	updatedAt,
	className 
}: PlaylistCardProps) {
	const [isHovered, setIsHovered] = useState(false)
	const isMobile = useIsMobile()
	
	const totalDuration = tracks.reduce((sum, track) => sum + (track.duration || 0), 0)
	const gradientClass = getGradientFromTitle(title)
	
	return (
		<NavLink
			to={id}
			preventScrollReset
			prefetch="intent"
			className={({ isActive }) =>
				cn(
					'group block transition-all duration-300 ease-out hover:scale-[1.02] hover:shadow-xl',
					isActive && 'ring-2 ring-primary ring-offset-2',
					className
				)
			}
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
		>
			<Card className="h-full overflow-hidden border-0 shadow-sm hover:shadow-lg transition-all duration-300 ease-out">
				<CardContent className="p-0">
					{/* Cover Section */}
					<div className={cn(
						'relative h-24 md:h-32 bg-gradient-to-br',
						gradientClass
					)}>
						<div className="absolute inset-0 bg-black/20" />
						
						{/* Play Button Overlay */}
						<div className={cn(
							'absolute inset-0 flex items-center justify-center transition-all duration-300 ease-out',
							isHovered || isMobile ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
						)}>
							<Button
								variant="secondary"
								size={isMobile ? "default" : "lg"}
								className={cn(
									"rounded-full shadow-lg transition-all duration-200 ease-out hover:scale-110",
									isMobile ? "h-10 w-10" : "h-12 w-12"
								)}
								onClick={(e) => {
									e.preventDefault()
									// TODO: Implement play all functionality
								}}
							>
								<Icon name="play" className={cn("ml-0.5 transition-transform duration-200", isMobile ? "h-4 w-4" : "h-6 w-6")} />
							</Button>
						</div>

						{/* Cover Image */}
						<div className={cn(
							"absolute bottom-2 left-2 md:bottom-4 md:left-4"
						)}>
							<PlaylistCover tracks={tracks} size="sm" />
						</div>

						{/* Quick Actions */}
						<div className={cn(
							'absolute top-2 right-2 md:top-3 md:right-3 flex gap-1 transition-all duration-300 ease-out',
							isHovered || isMobile ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'
						)}>
							<Button
								variant="secondary"
								size="sm"
								className={cn(
									"p-0 rounded-full transition-all duration-200 ease-out hover:scale-110",
									isMobile ? "h-6 w-6" : "h-8 w-8"
								)}
								onClick={(e) => {
									e.preventDefault()
									// TODO: Implement edit functionality
								}}
							>
								<Icon name="pencil-1" className={cn("transition-transform duration-200", isMobile ? "h-3 w-3" : "h-4 w-4")} />
							</Button>
						</div>
					</div>

					{/* Content Section */}
					<div className="p-3 md:p-4 space-y-2 md:space-y-3">
						<div>
							<h3 className="font-semibold text-sm md:text-lg line-clamp-2 mb-1 group-hover:text-primary transition-colors">
								{title}
							</h3>
							{description && (
								<p className="text-xs md:text-sm text-muted-foreground line-clamp-2">
									{description}
								</p>
							)}
						</div>

						{/* Stats */}
						<div className="flex items-center gap-2 md:gap-4 text-xs text-muted-foreground">
							<div className="flex items-center gap-1">
								<Icon name="file-text" className="h-3 w-3" />
								<span>{tracks.length} track{tracks.length !== 1 ? 's' : ''}</span>
							</div>
							{totalDuration > 0 && (
								<div className="flex items-center gap-1">
									<Icon name="clock" className="h-3 w-3" />
									<span>{formatDuration(totalDuration)}</span>
								</div>
							)}
						</div>

						{/* Last Updated */}
						<div className="text-xs text-muted-foreground">
							Updated {new Date(updatedAt).toLocaleDateString()}
						</div>
					</div>
				</CardContent>
			</Card>
		</NavLink>
	)
}
