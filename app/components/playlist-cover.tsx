import { Icon } from '#app/components/ui/icon.tsx'
import { cn } from '#app/utils/misc.tsx'

interface Track {
	id: string
	coverImage: { objectKey: string } | null
}

interface PlaylistCoverProps {
	tracks: Track[]
	size?: 'sm' | 'md' | 'lg'
	className?: string
}

const sizeClasses = {
	sm: 'h-16 w-16',
	md: 'h-24 w-24', 
	lg: 'h-32 w-32'
}

export function PlaylistCover({ tracks, size = 'md', className }: PlaylistCoverProps) {
	const thumbnails = tracks
		.filter(track => track.coverImage?.objectKey)
		.slice(0, 4)
		.map(track => ({
			id: track.id,
			url: `/resources/images?src=${encodeURIComponent(track.coverImage!.objectKey)}&w=64&h=64&fit=cover&format=webp`
		}))

	if (thumbnails.length === 0) {
		return (
			<div className={cn(
				'rounded-lg bg-gradient-to-br from-muted to-muted/60 flex items-center justify-center',
				sizeClasses[size],
				className
			)}>
				<Icon name="file-text" className="h-6 w-6 text-muted-foreground" />
			</div>
		)
	}

	if (thumbnails.length === 1) {
		return (
			<div className={cn('rounded-lg overflow-hidden', sizeClasses[size], className)}>
				<img
					src={thumbnails[0]?.url || ''}
					alt="Playlist cover"
					className="w-full h-full object-cover"
					loading="lazy"
				/>
			</div>
		)
	}

	// Create a mosaic layout for multiple thumbnails
	const gridClasses = thumbnails.length === 2 
		? 'grid-cols-2' 
		: thumbnails.length === 3 
		? 'grid-cols-2' 
		: 'grid-cols-2'

	return (
		<div className={cn(
			'rounded-lg overflow-hidden grid gap-0.5',
			gridClasses,
			sizeClasses[size],
			className
		)}>
			{thumbnails.map((thumbnail, index) => {
				// For 3 thumbnails, make the first one span 2 rows
				if (thumbnails.length === 3 && index === 0) {
					return (
						<div key={thumbnail.id} className="row-span-2">
							<img
								src={thumbnail.url}
								alt="Playlist cover"
								className="w-full h-full object-cover"
								loading="lazy"
							/>
						</div>
					)
				}
				
				return (
					<div key={thumbnail.id}>
						<img
							src={thumbnail.url}
							alt="Playlist cover"
							className="w-full h-full object-cover"
							loading="lazy"
						/>
					</div>
				)
			})}
		</div>
	)
}
