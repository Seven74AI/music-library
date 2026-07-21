import { Icon } from "#app/components/ui/icon";
import { useOfflineCoverUrl } from "#app/hooks/use-offline-cover-url.ts";
import { trackThumbnailPixelSizes } from "#app/utils/cover-image-url.ts";
import { cn } from "#app/utils/misc";

interface TrackThumbnailProps {
  coverImage: { objectKey: string } | null | undefined;
  thumbnailUrl?: string | null; // Placeholder thumbnail URL (e.g., from YouTube) when coverImage is not available
  alt?: string;
  size?: keyof typeof sizeClasses;
  /** Override proxy resize dimensions (defaults to 2x the display size for retina). */
  pixelSize?: number;
  className?: string;
}

const sizeClasses = {
  xs: "h-8 w-8",
  sm: "h-10 w-10",
  md: "h-12 w-12",
  lg: "h-14 w-14",
};

const iconSizeClasses = {
  xs: "h-4 w-4",
  sm: "h-5 w-5",
  md: "h-6 w-6",
  lg: "h-7 w-7",
};

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
  thumbnailUrl,
  alt = "Track cover",
  size = "md",
  pixelSize,
  className,
}: TrackThumbnailProps) {
  const sizeClass = sizeClasses[size];
  const iconSizeClass = iconSizeClasses[size];
  const requestedPixels = pixelSize ?? trackThumbnailPixelSizes[size];
  const offlineCoverUrl = useOfflineCoverUrl(coverImage?.objectKey, requestedPixels);

  const imageUrl = offlineCoverUrl ?? (thumbnailUrl || null);

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={alt}
        className={cn("rounded object-cover flex-shrink-0", sizeClass, className)}
        loading="lazy"
      />
    );
  }

  return (
    <div
      className={cn(
        "rounded bg-muted flex items-center justify-center flex-shrink-0",
        sizeClass,
        className,
      )}
    >
      <Icon name="file-text" className={cn("text-muted-foreground", iconSizeClass)} />
    </div>
  );
}
