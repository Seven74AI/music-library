import { Icon } from '#app/components/ui/icon'
import { cn } from '#app/utils/misc'

interface TrackThumbnailProps {
	coverImage: { objectKey: string } | null | undefined
	alt?: string
	size?: 'xs' | 'sm' | 'md' | 'lg'
	className?: string
}

const sizeClasses = {
	xs: 'h-8 w-8',
	sm: 'h-10 w-10',
	md: 'h-12 w-12',
	lg: 'h-14 w-14',
}

const iconSizeClasses = {
	xs: 'h-4 w-4',
	sm: 'h-5 w-5',
	md: 'h-6 w-6',
	lg: 'h-7 w-7',
}

/**
 * Reusable track thumbnail component with consistent placeholder
 * 
 * @param coverImage - The track's cover image object (null/undefined shows placeholder)
 * @param alt - Alt text for the image
 * @param size - Size variant (xs, sm, md, lg)
 * @param className - Additional CSS classes
 */
export function TrackThumbnail({ 
	coverImage, 
	alt = 'Track cover', 
	size = 'md',
	className 
}: TrackThumbnailProps) {
	const sizeClass = sizeClasses[size]
	const iconSizeClass = iconSizeClasses[size]
	
	// Use optimized image URL if cover image exists
	const imageUrl = coverImage?.objectKey
		? `/resources/images?src=${encodeURIComponent(coverImage.objectKey)}&w=${size === 'xs' ? 32 : size === 'sm' ? 40 : size === 'md' ? 48 : 56}&h=${size === 'xs' ? 32 : size === 'sm' ? 40 : size === 'md' ? 48 : 56}&fit=cover&format=webp`
		: null

	if (imageUrl) {
		return (
			<img
				src={imageUrl}
				alt={alt}
				className={cn('rounded object-cover flex-shrink-0', sizeClass, className)}
				loading="lazy"
			/>
		)
	}

	return (
		<div className={cn(
			'rounded bg-muted flex items-center justify-center flex-shrink-0',
			sizeClass,
			className
		)}>
			<Icon name="file-text" className={cn('text-muted-foreground', iconSizeClass)} />
		</div>
	)
}



